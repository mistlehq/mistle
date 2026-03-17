import {
  integrationConnectionCredentials,
  integrationConnections,
  IntegrationConnectionCredentialPurposes,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { eq, sql } from "drizzle-orm";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../integration-credentials/crypto.js";
import type { AppContext } from "../../types.js";
import { assertApiKeyConnectionMethodSupportedOrThrow } from "./create-api-key-connection.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsNotFoundCodes,
  IntegrationConnectionsNotFoundError,
} from "./errors.js";

const registry = createIntegrationRegistry();

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

export type UpdateApiKeyConnectionInput = {
  organizationId: string;
  connectionId: string;
  displayName: string;
  apiKey: string;
};

function resolveConnectionMethodId(config: Record<string, unknown> | null): string | null {
  if (config === null) {
    return null;
  }

  const connectionMethodId = config["connection_method"];
  if (connectionMethodId !== IntegrationConnectionMethodIds.API_KEY) {
    return null;
  }

  return IntegrationConnectionMethodIds.API_KEY;
}

export async function updateApiKeyConnection(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: UpdateApiKeyConnectionInput,
): Promise<UpdatedConnection> {
  const existingConnection = await db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
  });

  if (existingConnection === undefined) {
    throw new IntegrationConnectionsNotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  const existingConnectionMethodId = resolveConnectionMethodId(existingConnection.config);
  const normalizedApiKey = input.apiKey.trim();

  if (normalizedApiKey.length === 0) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      "`apiKey` must contain at least one non-whitespace character when provided.",
    );
  }

  const target = await db.query.integrationTargets.findFirst({
    where: (table, { eq }) => eq(table.targetKey, existingConnection.targetKey),
  });

  if (target === undefined) {
    throw new IntegrationConnectionsNotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${existingConnection.targetKey}' was not found.`,
    );
  }

  const definition = registry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  if (existingConnectionMethodId !== IntegrationConnectionMethodIds.API_KEY) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.API_KEY_CONNECTION_REQUIRED,
      `Integration connection '${input.connectionId}' is not an API-key connection.`,
    );
  }

  assertApiKeyConnectionMethodSupportedOrThrow({
    targetKey: existingConnection.targetKey,
    connectionMethods: definition.connectionMethods,
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
    const encryptedApiKey = encryptCredentialUtf8({
      plaintext: normalizedApiKey,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    return await db.transaction(async (tx) => {
      const [createdCredential] = await tx
        .insert(integrationCredentials)
        .values({
          organizationId: input.organizationId,
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          ciphertext: encryptedApiKey.ciphertext,
          nonce: encryptedApiKey.nonce,
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
          purpose: IntegrationConnectionCredentialPurposes.API_KEY,
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

      const [updatedConnection] = await tx
        .update(integrationConnections)
        .set({
          displayName: input.displayName,
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
