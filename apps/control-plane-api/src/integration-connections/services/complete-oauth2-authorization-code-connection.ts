import {
  integrationConnectionCredentials,
  IntegrationConnectionCredentialPurposes,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
  integrationConnectionRedirectSessions,
} from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, isNull } from "drizzle-orm";

import {
  decryptRedirectSessionSecretUtf8,
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import { createRedirectQueryParams, resolveRedirectDisplayName } from "./redirect-flow.js";
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
    `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth2-authorization-code/complete`,
    input.controlPlaneBaseUrl,
  ).toString();
}

function resolveRedirectStateOrThrow(params: URLSearchParams): string {
  const state = params.get("state");
  if (state === null || state.length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_COMPLETE_INPUT,
      "OAuth 2.0 (Authorization Code) callback query must include `state`.",
    );
  }

  return state;
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

  const redirectSession = await db.query.integrationConnectionRedirectSessions.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.state, state)),
  });

  if (redirectSession === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state is invalid.",
    );
  }

  const requestedDisplayName = resolveRedirectDisplayName(redirectSession.state);

  if (redirectSession.usedAt !== null) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
      "Redirect state has already been used.",
    );
  }

  const now = Date.now();
  const expiresAt = Date.parse(redirectSession.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new Error(`Redirect session '${redirectSession.id}' has an invalid expiry timestamp.`);
  }

  if (expiresAt <= now) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
      "Redirect state has expired.",
    );
  }

  const redirectUrl = buildOAuth2AuthorizationCodeCompleteUrl({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    targetKey: input.targetKey,
  });
  const pkceVerifier = resolvePkceVerifier({
    pkceVerifierEncrypted: redirectSession.pkceVerifierEncrypted,
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

      await tx.insert(integrationConnectionCredentials).values({
        connectionId: createdConnection.id,
        credentialId: createdAccessTokenCredential.id,
        purpose: IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN,
      });

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

        await tx.insert(integrationConnectionCredentials).values({
          connectionId: createdConnection.id,
          credentialId: createdRefreshTokenCredential.id,
          purpose: IntegrationConnectionCredentialPurposes.OAUTH2_REFRESH_TOKEN,
        });
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
