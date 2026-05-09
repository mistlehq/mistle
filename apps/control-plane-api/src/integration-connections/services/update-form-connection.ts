import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
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
import { assertIdentityLinkingAuthEditableOrThrow } from "./assert-identity-linking-auth-editable.js";
import {
  buildFormConnectionMethodContextOrThrow,
  parseFormConnectionConfigOrThrow,
  parseUpdateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
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
  secrets?: Record<string, string>;
};

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

  await assertIdentityLinkingAuthEditableOrThrow({
    db,
    organizationId: input.organizationId,
    connectionId: existingConnection.id,
  });

  const connectionMethodIdValue = existingConnection.config?.["connection_method"];
  const existingConnectionMethodId =
    typeof connectionMethodIdValue === "string" && connectionMethodIdValue.length > 0
      ? connectionMethodIdValue
      : null;
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
    formContext: buildFormConnectionMethodContextOrThrow({
      targetKey: existingConnection.targetKey,
      target,
      currentValue: input.config,
      connection: {
        id: existingConnection.id,
        config: existingConnection.config,
      },
      definition,
      invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
    }),
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
  });
  const parsedSecrets = input.secrets
    ? parseUpdateFormSecretsOrThrow({
        method: formMethod,
        secrets: input.secrets,
        invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      })
    : [];

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
      const tables = getControlPlaneDatabaseSchema(tx);

      for (const parsedSecret of parsedSecrets) {
        const encryptedSecret = encryptCredentialUtf8({
          plaintext: parsedSecret.normalizedValue,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });

        const [createdCredential] = await tx
          .insert(tables.integrationCredentials)
          .values({
            organizationId: input.organizationId,
            secretKind: parsedSecret.persistedSecretRef.secretKind,
            ciphertext: encryptedSecret.ciphertext,
            nonce: encryptedSecret.nonce,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            intendedFamilyId: target.familyId,
          })
          .returning({
            id: tables.integrationCredentials.id,
          });

        if (createdCredential === undefined) {
          throw new Error("Failed to create integration credential.");
        }

        await tx
          .insert(tables.integrationConnectionCredentials)
          .values({
            connectionId: existingConnection.id,
            credentialId: createdCredential.id,
            slotKey: parsedSecret.persistedSecretRef.slotKey,
          })
          .onConflictDoUpdate({
            target: [
              tables.integrationConnectionCredentials.connectionId,
              tables.integrationConnectionCredentials.slotKey,
            ],
            set: {
              credentialId: createdCredential.id,
            },
          });
      }

      const [updatedConnection] = await tx
        .update(tables.integrationConnections)
        .set({
          displayName: input.displayName,
          config: {
            ...parsedConfig,
            connection_method: existingConnectionMethodId,
          },
          updatedAt: sql`now()`,
        })
        .where(eq(tables.integrationConnections.id, existingConnection.id))
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
