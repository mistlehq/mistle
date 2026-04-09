import {
  integrationConnectionCredentials,
  integrationConnections,
  type ControlPlaneDatabase,
  IntegrationConnectionStatuses,
  integrationCredentials,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationConnectionMethodId, IntegrationRegistry } from "@mistle/integrations-core";
import { IntegrationWebhookSourceLifecycles } from "@mistle/integrations-core";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import {
  parseFormConnectionConfigOrThrow,
  parseCreateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
} from "./form-connection-methods.js";
import { ensureImplicitConnectionWebhookSource } from "./webhook-sources.js";

export type CreateFormConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName: string;
  methodId: IntegrationConnectionMethodId;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

type CreatedConnection = {
  id: string;
  targetKey: string;
  displayName: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export async function createFormConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: CreateFormConnectionInput,
): Promise<CreatedConnection> {
  const { db, integrationRegistry, integrationsConfig } = ctx;

  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${input.targetKey}' was not found.`,
    );
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: input.targetKey,
    methodId: input.methodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });
  const parsedConfig = parseFormConnectionConfigOrThrow({
    targetKey: input.targetKey,
    method: formMethod,
    config: input.config,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });
  const parsedSecrets = parseCreateFormSecretsOrThrow({
    targetKey: input.targetKey,
    method: formMethod,
    secrets: input.secrets,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });

  const organizationCredentialKey = await db.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: integrationsConfig.masterEncryptionKeys,
  });

  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    return await db.transaction(async (tx) => {
      const [createdConnection] = await tx
        .insert(integrationConnections)
        .values({
          organizationId: input.organizationId,
          targetKey: input.targetKey,
          displayName: input.displayName,
          status: IntegrationConnectionStatuses.ACTIVE,
          config: {
            ...parsedConfig,
            connection_method: input.methodId,
          },
          targetSnapshotConfig: target.config,
        })
        .returning();

      if (createdConnection === undefined) {
        throw new Error("Failed to create integration connection.");
      }

      for (const parsedSecret of parsedSecrets) {
        const encryptedSecret = encryptCredentialUtf8({
          plaintext: parsedSecret.normalizedValue,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });

        const [createdCredential] = await tx
          .insert(integrationCredentials)
          .values({
            organizationId: input.organizationId,
            secretKind: parsedSecret.persistedSecretRef.secretKind,
            ciphertext: encryptedSecret.ciphertext,
            nonce: encryptedSecret.nonce,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            intendedFamilyId: target.familyId,
          })
          .returning({
            id: integrationCredentials.id,
          });

        if (createdCredential === undefined) {
          throw new Error("Failed to create integration credential.");
        }

        await tx.insert(integrationConnectionCredentials).values({
          connectionId: createdConnection.id,
          credentialId: createdCredential.id,
          slotKey: parsedSecret.persistedSecretRef.slotKey,
        });
      }

      const webhookSourceCapability = definition.webhookSource;
      if (
        webhookSourceCapability?.lifecycle === IntegrationWebhookSourceLifecycles.IMPLICIT &&
        ((await webhookSourceCapability.supportsConnection?.({
          connection: {
            id: createdConnection.id,
            status: createdConnection.status,
            config: {
              ...parsedConfig,
              connection_method: input.methodId,
            },
          },
        })) ??
          true)
      ) {
        await ensureImplicitConnectionWebhookSource({
          db: tx,
          organizationId: input.organizationId,
          connectionId: createdConnection.id,
          targetKey: input.targetKey,
        });
      }

      return {
        id: createdConnection.id,
        targetKey: createdConnection.targetKey,
        displayName: createdConnection.displayName,
        status: createdConnection.status,
        ...(createdConnection.externalSubjectId === null
          ? {}
          : { externalSubjectId: createdConnection.externalSubjectId }),
        ...(createdConnection.config === null ? {} : { config: createdConnection.config }),
        ...(createdConnection.targetSnapshotConfig === null
          ? {}
          : { targetSnapshotConfig: createdConnection.targetSnapshotConfig }),
        createdAt: createdConnection.createdAt,
        updatedAt: createdConnection.updatedAt,
      };
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}
