import {
  integrationConnectionCredentials,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
} from "@mistle/db/control-plane";
import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";

import {
  encryptCredentialUtf8,
  encryptIntegrationConnectionSecrets,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../integration-credentials/crypto.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
  IntegrationConnectionsNotFoundError,
} from "./errors.js";
import { resolveConnectionUserSecretsOrThrow } from "./resolve-user-secrets.js";

const API_KEY_CREDENTIAL_PURPOSE = "api_key";

export type CreateApiKeyConnectionInput = {
  organizationId: string;
  targetKey: string;
  apiKey: string;
  connectionSecrets: Record<string, string>;
};

type CreatedConnection = {
  id: string;
  targetKey: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export async function createApiKeyConnection(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: CreateApiKeyConnectionInput,
): Promise<CreatedConnection> {
  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new IntegrationConnectionsNotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${input.targetKey}' was not found.`,
    );
  }

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

  const parsedConnectionSecrets = resolveConnectionUserSecretsOrThrow({
    familyId: target.familyId,
    variantId: target.variantId,
    targetKey: input.targetKey,
    rawSecrets: input.connectionSecrets,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });

  const encryptedConnectionSecrets =
    Object.keys(parsedConnectionSecrets).length === 0
      ? null
      : encryptIntegrationConnectionSecrets({
          secrets: parsedConnectionSecrets,
          masterKeyVersion: integrationsConfig.activeMasterEncryptionKeyVersion,
          masterEncryptionKeyMaterial: resolveMasterEncryptionKeyMaterial({
            masterKeyVersion: integrationsConfig.activeMasterEncryptionKeyVersion,
            masterEncryptionKeys: integrationsConfig.masterEncryptionKeys,
          }),
        });

  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedApiKey = encryptCredentialUtf8({
      plaintext: input.apiKey,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    return await db.transaction(async (tx) => {
      const [createdConnection] = await tx
        .insert(integrationConnections)
        .values({
          organizationId: input.organizationId,
          targetKey: input.targetKey,
          status: IntegrationConnectionStatuses.ACTIVE,
          config: {
            auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
          },
          ...(encryptedConnectionSecrets === null ? {} : { secrets: encryptedConnectionSecrets }),
          targetSnapshotConfig: target.config,
        })
        .returning();

      if (createdConnection === undefined) {
        throw new Error("Failed to create integration connection.");
      }

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

      await tx.insert(integrationConnectionCredentials).values({
        connectionId: createdConnection.id,
        credentialId: createdCredential.id,
        purpose: API_KEY_CREDENTIAL_PURPOSE,
      });

      return {
        id: createdConnection.id,
        targetKey: createdConnection.targetKey,
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
