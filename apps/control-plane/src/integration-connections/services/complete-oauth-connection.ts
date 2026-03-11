import {
  integrationConnectionCredentials,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
  integrationOauthSessions,
} from "@mistle/db/control-plane";
import { and, eq, isNull } from "drizzle-orm";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../integration-credentials/crypto.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsBadRequestError,
} from "./errors.js";
import { resolveOauthHandlerTargetOrThrow } from "./resolve-oauth-handler.js";

type CompleteOAuthConnectionInput = {
  organizationId: string;
  targetKey: string;
  query: Record<string, string>;
};

type CompletedConnection = {
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

function createOAuthQueryParams(query: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    params.set(key, value);
  }

  return params;
}

function resolveOAuthStateOrThrow(params: URLSearchParams): string {
  const state = params.get("state");
  if (state === null || state.length === 0) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_OAUTH_COMPLETE_INPUT,
      "OAuth callback query must include `state`.",
    );
  }

  return state;
}

function resolveOAuthDisplayName(state: string): string | undefined {
  const separatorIndex = state.indexOf(".");
  if (separatorIndex < 0 || separatorIndex === state.length - 1) {
    return undefined;
  }

  const encodedDisplayName = state.slice(separatorIndex + 1);
  const displayName = Buffer.from(encodedDisplayName, "base64url").toString("utf8").trim();
  if (displayName.length === 0) {
    return undefined;
  }

  return displayName;
}

function resolveCredentialSecretKind(secretType: string) {
  if (secretType === IntegrationCredentialSecretKinds.API_KEY) {
    return IntegrationCredentialSecretKinds.API_KEY;
  }

  if (secretType === IntegrationCredentialSecretKinds.OAUTH_ACCESS_TOKEN) {
    return IntegrationCredentialSecretKinds.OAUTH_ACCESS_TOKEN;
  }

  throw new Error(`Unsupported OAuth credential secret type '${secretType}'.`);
}

export async function completeOAuthConnection(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: CompleteOAuthConnectionInput,
): Promise<CompletedConnection> {
  const resolved = await resolveOauthHandlerTargetOrThrow(db, integrationsConfig, {
    targetKey: input.targetKey,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_OAUTH_COMPLETE_INPUT,
  });

  const queryParams = createOAuthQueryParams(input.query);
  const state = resolveOAuthStateOrThrow(queryParams);

  const oauthSession = await db.query.integrationOauthSessions.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.targetKey, input.targetKey),
        eq(table.state, state),
      ),
  });

  if (oauthSession === undefined) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.OAUTH_STATE_INVALID,
      "OAuth state is invalid.",
    );
  }

  const requestedDisplayName = resolveOAuthDisplayName(oauthSession.state);

  if (oauthSession.usedAt !== null) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.OAUTH_STATE_ALREADY_USED,
      "OAuth state has already been used.",
    );
  }

  const now = Date.now();
  const expiresAt = Date.parse(oauthSession.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new Error(`OAuth session '${oauthSession.id}' has an invalid expiry timestamp.`);
  }

  if (expiresAt <= now) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.OAUTH_STATE_EXPIRED,
      "OAuth state has expired.",
    );
  }

  const completedOAuthConnection = await resolved.oauthHandler.complete({
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    target: resolved.target,
    query: queryParams,
  });

  return db.transaction(async (tx) => {
    const usedAtTimestamp = new Date().toISOString();
    const consumedSessionRows = await tx
      .update(integrationOauthSessions)
      .set({
        usedAt: usedAtTimestamp,
      })
      .where(
        and(
          eq(integrationOauthSessions.id, oauthSession.id),
          isNull(integrationOauthSessions.usedAt),
        ),
      )
      .returning({
        id: integrationOauthSessions.id,
      });

    if (consumedSessionRows.length !== 1) {
      throw new IntegrationConnectionsBadRequestError(
        IntegrationConnectionsBadRequestCodes.OAUTH_STATE_ALREADY_USED,
        "OAuth state has already been used.",
      );
    }

    const [createdConnection] = await tx
      .insert(integrationConnections)
      .values({
        organizationId: input.organizationId,
        targetKey: input.targetKey,
        displayName:
          requestedDisplayName ?? completedOAuthConnection.externalSubjectId ?? input.targetKey,
        status: IntegrationConnectionStatuses.ACTIVE,
        ...(completedOAuthConnection.externalSubjectId === undefined
          ? {}
          : { externalSubjectId: completedOAuthConnection.externalSubjectId }),
        config: completedOAuthConnection.connectionConfig,
        targetSnapshotConfig: resolved.target.config,
      })
      .returning();

    if (createdConnection === undefined) {
      throw new Error("Failed to create integration connection from OAuth callback.");
    }

    if (completedOAuthConnection.credentialMaterials.length > 0) {
      const organizationCredentialKey = await tx.query.organizationCredentialKeys.findFirst({
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
        for (const material of completedOAuthConnection.credentialMaterials) {
          const encryptedCredential = encryptCredentialUtf8({
            plaintext: material.plaintext,
            organizationCredentialKey: unwrappedOrganizationCredentialKey,
          });

          const [createdCredential] = await tx
            .insert(integrationCredentials)
            .values({
              organizationId: input.organizationId,
              secretKind: resolveCredentialSecretKind(material.secretType),
              ciphertext: encryptedCredential.ciphertext,
              nonce: encryptedCredential.nonce,
              organizationCredentialKeyVersion: organizationCredentialKey.version,
              intendedFamilyId: resolved.target.familyId,
              ...(material.metadata === undefined ? {} : { metadata: material.metadata }),
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
            purpose: material.purpose,
          });
        }
      } finally {
        unwrappedOrganizationCredentialKey.fill(0);
      }
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
}
