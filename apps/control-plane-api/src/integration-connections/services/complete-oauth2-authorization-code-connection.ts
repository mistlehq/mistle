import {
  integrationConnectionCredentials,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
  integrationConnectionRedirectSessions,
} from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, isNull } from "drizzle-orm";

import {
  decryptRedirectSessionSecretUtf8,
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import {
  createRedirectQueryParams,
  resolveActiveRedirectSessionOrThrow,
  resolveRequiredRedirectQueryParamOrThrow,
  resolveRedirectDisplayName,
} from "./redirect-flow.js";
import { resolveOAuth2AuthorizationCodeCapabilityTargetOrThrow } from "./resolve-oauth2-authorization-code-capability-target.js";

type CompleteOAuth2AuthorizationCodeConnectionInput = {
  targetKey: string;
  query: Record<string, string>;
  controlPlaneBaseUrl: string;
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

function buildOAuth2AuthorizationCodeCompleteUrl(input: {
  controlPlaneBaseUrl: string;
  targetKey: string;
}): string {
  return new URL(
    `/p/integration/callbacks/${encodeURIComponent(input.targetKey)}/oauth2-authorization-code`,
    input.controlPlaneBaseUrl,
  ).toString();
}

function resolveRedirectStateOrThrow(params: URLSearchParams): string {
  return resolveRequiredRedirectQueryParamOrThrow({
    params,
    name: "state",
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_COMPLETE_INPUT,
    missingMessage: "OAuth 2.0 (Authorization Code) callback query must include `state`.",
  });
}

function resolvePkceVerifier(input: {
  pkceVerifierEncrypted: string | null;
  masterEncryptionKeys: Record<string, string>;
}): string | undefined {
  if (input.pkceVerifierEncrypted === null) {
    return undefined;
  }

  return decryptRedirectSessionSecretUtf8({
    ciphertext: input.pkceVerifierEncrypted,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });
}

function resolveProviderState(input: {
  providerStateEncrypted: string | null;
  masterEncryptionKeys: Record<string, string>;
}): Record<string, unknown> | undefined {
  if (input.providerStateEncrypted === null) {
    return undefined;
  }

  const plaintext = decryptRedirectSessionSecretUtf8({
    ciphertext: input.providerStateEncrypted,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });
  const parsed = JSON.parse(plaintext);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("OAuth 2.0 (Authorization Code) provider state must decode to an object.");
  }

  const providerState: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    providerState[key] = value;
  }

  return providerState;
}

export async function completeOAuth2AuthorizationCodeConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: CompleteOAuth2AuthorizationCodeConnectionInput,
): Promise<CompletedConnection> {
  const { db, integrationRegistry, integrationsConfig } = ctx;

  const resolved = await resolveOAuth2AuthorizationCodeCapabilityTargetOrThrow(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      targetKey: input.targetKey,
      invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_COMPLETE_INPUT,
    },
  );

  const queryParams = createRedirectQueryParams(input.query);
  const state = resolveRedirectStateOrThrow(queryParams);

  const redirectSession = await resolveActiveRedirectSessionOrThrow({
    db,
    targetKey: input.targetKey,
    state,
    invalidStateCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
    alreadyUsedCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    expiredCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
  });

  const requestedDisplayName = resolveRedirectDisplayName(redirectSession.state);

  const redirectUrl = buildOAuth2AuthorizationCodeCompleteUrl({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    targetKey: input.targetKey,
  });
  const pkceVerifier = resolvePkceVerifier({
    pkceVerifierEncrypted: redirectSession.pkceVerifierEncrypted,
    masterEncryptionKeys: integrationsConfig.masterEncryptionKeys,
  });
  const providerState = resolveProviderState({
    providerStateEncrypted: redirectSession.providerStateEncrypted,
    masterEncryptionKeys: integrationsConfig.masterEncryptionKeys,
  });
  const completedOAuth2AuthorizationCodeConnection =
    await resolved.oauth2AuthorizationCode.completeAuthorizationCodeGrant({
      organizationId: redirectSession.organizationId,
      targetKey: input.targetKey,
      target: resolved.target,
      query: queryParams,
      redirectUrl,
      ...(pkceVerifier === undefined ? {} : { pkceVerifier }),
      ...(providerState === undefined ? {} : { providerState }),
    });

  return db.transaction(async (tx) => {
    const usedAtTimestamp = new Date().toISOString();
    const consumedSessionRows = await tx
      .update(integrationConnectionRedirectSessions)
      .set({
        usedAt: usedAtTimestamp,
      })
      .where(
        and(
          eq(integrationConnectionRedirectSessions.id, redirectSession.id),
          isNull(integrationConnectionRedirectSessions.usedAt),
        ),
      )
      .returning({
        id: integrationConnectionRedirectSessions.id,
      });

    if (consumedSessionRows.length !== 1) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
        "Redirect state has already been used.",
      );
    }

    const [createdConnection] = await tx
      .insert(integrationConnections)
      .values({
        organizationId: redirectSession.organizationId,
        targetKey: input.targetKey,
        displayName:
          requestedDisplayName ??
          completedOAuth2AuthorizationCodeConnection.externalSubjectId ??
          input.targetKey,
        status: IntegrationConnectionStatuses.ACTIVE,
        ...(completedOAuth2AuthorizationCodeConnection.externalSubjectId === undefined
          ? {}
          : {
              externalSubjectId: completedOAuth2AuthorizationCodeConnection.externalSubjectId,
            }),
        config: {
          ...completedOAuth2AuthorizationCodeConnection.connectionConfig,
          connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        },
        targetSnapshotConfig: resolved.target.config,
      })
      .returning();

    if (createdConnection === undefined) {
      throw new Error(
        "Failed to create integration connection from OAuth 2.0 (Authorization Code) callback.",
      );
    }

    const organizationCredentialKey = await tx.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, redirectSession.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });

    if (organizationCredentialKey === undefined) {
      throw new Error(
        `Organization credential key is missing for '${redirectSession.organizationId}'.`,
      );
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
      const oauth2AuthorizationCodeSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
        familyId: resolved.target.familyId,
        variantId: resolved.target.variantId,
      });

      const encryptedAccessToken = encryptCredentialUtf8({
        plaintext: completedOAuth2AuthorizationCodeConnection.accessToken,
        organizationCredentialKey: unwrappedOrganizationCredentialKey,
      });
      const [createdAccessTokenCredential] = await tx
        .insert(integrationCredentials)
        .values({
          organizationId: redirectSession.organizationId,
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          ciphertext: encryptedAccessToken.ciphertext,
          nonce: encryptedAccessToken.nonce,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          intendedFamilyId: resolved.target.familyId,
          ...(completedOAuth2AuthorizationCodeConnection.credentialMetadata === undefined
            ? {}
            : { metadata: completedOAuth2AuthorizationCodeConnection.credentialMetadata }),
          ...(completedOAuth2AuthorizationCodeConnection.accessTokenExpiresAt === undefined
            ? {}
            : {
                expiresAt: completedOAuth2AuthorizationCodeConnection.accessTokenExpiresAt,
              }),
        })
        .returning({
          id: integrationCredentials.id,
        });

      if (createdAccessTokenCredential === undefined) {
        throw new Error("Failed to create OAuth 2.0 (Authorization Code) access token credential.");
      }

      const [createdAccessTokenCredentialLink] = await tx
        .insert(integrationConnectionCredentials)
        .values({
          connectionId: createdConnection.id,
          credentialId: createdAccessTokenCredential.id,
          slotKey: oauth2AuthorizationCodeSlotKeys.accessToken,
        })
        .returning({
          connectionId: integrationConnectionCredentials.connectionId,
        });

      if (createdAccessTokenCredentialLink === undefined) {
        throw new Error(
          "Failed to link OAuth 2.0 (Authorization Code) access token credential to the connection.",
        );
      }

      if (completedOAuth2AuthorizationCodeConnection.refreshToken !== undefined) {
        const encryptedRefreshToken = encryptCredentialUtf8({
          plaintext: completedOAuth2AuthorizationCodeConnection.refreshToken,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });
        const [createdRefreshTokenCredential] = await tx
          .insert(integrationCredentials)
          .values({
            organizationId: redirectSession.organizationId,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
            ciphertext: encryptedRefreshToken.ciphertext,
            nonce: encryptedRefreshToken.nonce,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            intendedFamilyId: resolved.target.familyId,
            ...(completedOAuth2AuthorizationCodeConnection.credentialMetadata === undefined
              ? {}
              : { metadata: completedOAuth2AuthorizationCodeConnection.credentialMetadata }),
            ...(completedOAuth2AuthorizationCodeConnection.refreshTokenExpiresAt === undefined
              ? {}
              : {
                  expiresAt: completedOAuth2AuthorizationCodeConnection.refreshTokenExpiresAt,
                }),
          })
          .returning({
            id: integrationCredentials.id,
          });

        if (createdRefreshTokenCredential === undefined) {
          throw new Error(
            "Failed to create OAuth 2.0 (Authorization Code) refresh token credential.",
          );
        }

        const [createdRefreshTokenCredentialLink] = await tx
          .insert(integrationConnectionCredentials)
          .values({
            connectionId: createdConnection.id,
            credentialId: createdRefreshTokenCredential.id,
            slotKey: oauth2AuthorizationCodeSlotKeys.refreshToken,
          })
          .returning({
            connectionId: integrationConnectionCredentials.connectionId,
          });

        if (createdRefreshTokenCredentialLink === undefined) {
          throw new Error(
            "Failed to link OAuth 2.0 (Authorization Code) refresh token credential to the connection.",
          );
        }
      }

      if (completedOAuth2AuthorizationCodeConnection.clientSecret !== undefined) {
        const encryptedClientSecret = encryptCredentialUtf8({
          plaintext: completedOAuth2AuthorizationCodeConnection.clientSecret,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });
        const [createdClientSecretCredential] = await tx
          .insert(integrationCredentials)
          .values({
            organizationId: redirectSession.organizationId,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
            ciphertext: encryptedClientSecret.ciphertext,
            nonce: encryptedClientSecret.nonce,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            intendedFamilyId: resolved.target.familyId,
            ...(completedOAuth2AuthorizationCodeConnection.credentialMetadata === undefined
              ? {}
              : { metadata: completedOAuth2AuthorizationCodeConnection.credentialMetadata }),
          })
          .returning({
            id: integrationCredentials.id,
          });

        if (createdClientSecretCredential === undefined) {
          throw new Error(
            "Failed to create OAuth 2.0 (Authorization Code) client secret credential.",
          );
        }

        const [createdClientSecretCredentialLink] = await tx
          .insert(integrationConnectionCredentials)
          .values({
            connectionId: createdConnection.id,
            credentialId: createdClientSecretCredential.id,
            slotKey: oauth2AuthorizationCodeSlotKeys.clientSecret,
          })
          .returning({
            connectionId: integrationConnectionCredentials.connectionId,
          });

        if (createdClientSecretCredentialLink === undefined) {
          throw new Error(
            "Failed to link OAuth 2.0 (Authorization Code) client secret credential to the connection.",
          );
        }
      }
    } finally {
      unwrappedOrganizationCredentialKey.fill(0);
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
