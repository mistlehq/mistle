import {
  integrationConnectionCredentials,
  integrationConnections,
  type ControlPlaneDatabase,
  integrationCredentials,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationConnectionMethodId, IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";

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
  resolveFormConnectionMethodOrThrow,
  resolvePersistedSecretRefOrThrow,
} from "./form-connection-methods.js";

type UpdatedConnection = {
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

export type UpdateFormConnectionInput = {
  organizationId: string;
  connectionId: string;
  displayName: string;
  config: Record<string, unknown>;
  secret?: string;
};

function resolveConnectionMethodId(
  config: Record<string, unknown> | null,
): IntegrationConnectionMethodId | null {
  if (config === null) {
    return null;
  }

  const connectionMethodId = config["connection_method"];
  if (typeof connectionMethodId !== "string" || connectionMethodId.length === 0) {
    return null;
  }

  return connectionMethodId;
}

export async function updateFormConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: UpdateFormConnectionInput,
): Promise<UpdatedConnection> {
  const { db, integrationRegistry, integrationsConfig } = ctx;

  const existingConnection = await db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
  });

  if (existingConnection === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  const existingConnectionMethodId = resolveConnectionMethodId(existingConnection.config);
  if (existingConnectionMethodId === null) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_REQUIRED,
      `Integration connection '${input.connectionId}' is not a form connection.`,
    );
  }

  const target = await db.query.integrationTargets.findFirst({
    where: (table, { eq }) => eq(table.targetKey, existingConnection.targetKey),
  });

  if (target === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${existingConnection.targetKey}' was not found.`,
    );
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: existingConnection.targetKey,
    methodId: existingConnectionMethodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
  });
  const parsedConfig = parseFormConnectionConfigOrThrow({
    targetKey: existingConnection.targetKey,
    method: formMethod,
    config: input.config,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
  });
  const persistedSecretRef = resolvePersistedSecretRefOrThrow({
    secretType: formMethod.secretType,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
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
      if (input.secret !== undefined) {
        const normalizedSecret = input.secret.trim();
        if (normalizedSecret.length === 0) {
          throw new BadRequestError(
            IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
            "`secret` must contain at least one non-whitespace character when provided.",
          );
        }

        const encryptedSecret = encryptCredentialUtf8({
          plaintext: normalizedSecret,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });

        const [createdCredential] = await tx
          .insert(integrationCredentials)
          .values({
            organizationId: input.organizationId,
            secretKind: persistedSecretRef.secretKind,
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

        await tx
          .insert(integrationConnectionCredentials)
          .values({
            connectionId: existingConnection.id,
            credentialId: createdCredential.id,
            purpose: persistedSecretRef.purpose,
          })
          .onConflictDoUpdate({
            target: [
              integrationConnectionCredentials.connectionId,
              integrationConnectionCredentials.purpose,
            ],
            set: {
              credentialId: createdCredential.id,
            },
          });
      }

      const [updatedConnection] = await tx
        .update(integrationConnections)
        .set({
          displayName: input.displayName,
          config: {
            ...parsedConfig,
            connection_method: existingConnectionMethodId,
          },
          updatedAt: sql`now()`,
        })
        .where(eq(integrationConnections.id, existingConnection.id))
        .returning();

      if (updatedConnection === undefined) {
        throw new Error("Failed to update integration connection.");
      }

      return {
        id: updatedConnection.id,
        targetKey: updatedConnection.targetKey,
        displayName: updatedConnection.displayName,
        status: updatedConnection.status,
        ...(updatedConnection.externalSubjectId === null
          ? {}
          : { externalSubjectId: updatedConnection.externalSubjectId }),
        ...(updatedConnection.config === null ? {} : { config: updatedConnection.config }),
        ...(updatedConnection.targetSnapshotConfig === null
          ? {}
          : { targetSnapshotConfig: updatedConnection.targetSnapshotConfig }),
        createdAt: updatedConnection.createdAt,
        updatedAt: updatedConnection.updatedAt,
      };
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}
