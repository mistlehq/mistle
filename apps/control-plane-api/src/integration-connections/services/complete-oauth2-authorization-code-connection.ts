import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  IntegrationConnectionRedirectSessionIntents,
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  decryptRedirectSessionSecretUtf8,
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { logger } from "../../logger.js";
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
  authorizationIntent: "create" | "reauthorize";
  targetKey: string;
  displayName: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

async function revokeLinkedCredentialSlot(input: {
  tx: ControlPlaneDatabase;
  connectionId: string;
  slotKey: string;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.tx);
  const linkedCredential = await input.tx.query.integrationConnectionCredentials.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.connectionId, input.connectionId), eq(table.slotKey, input.slotKey)),
  });

  if (linkedCredential === undefined) {
    return;
  }

  await input.tx
    .delete(tables.integrationConnectionCredentials)
    .where(
      and(
        eq(tables.integrationConnectionCredentials.connectionId, input.connectionId),
        eq(tables.integrationConnectionCredentials.slotKey, input.slotKey),
      ),
    );
  await input.tx
    .update(tables.integrationCredentials)
    .set({
      revokedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.integrationCredentials.id, linkedCredential.credentialId),
        isNull(tables.integrationCredentials.revokedAt),
      ),
    );
}

async function createAndLinkOAuth2Credential(input: {
  tx: ControlPlaneDatabase;
  organizationId: string;
  familyId: string;
  connectionId: string;
  slotKey: string;
  secretKind:
    | typeof IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN
    | typeof IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN
    | typeof IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET;
  plaintext: string;
  organizationCredentialKeyVersion: number;
  organizationCredentialKey: Buffer;
  credentialMetadata?: Record<string, unknown>;
  expiresAt?: string;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.tx);
  const existingLink = await input.tx.query.integrationConnectionCredentials.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.connectionId, input.connectionId), eq(table.slotKey, input.slotKey)),
  });
  const encryptedCredential = encryptCredentialUtf8({
    plaintext: input.plaintext,
    organizationCredentialKey: input.organizationCredentialKey,
  });

  const [createdCredential] = await input.tx
    .insert(tables.integrationCredentials)
    .values({
      organizationId: input.organizationId,
      secretKind: input.secretKind,
      ciphertext: encryptedCredential.ciphertext,
      nonce: encryptedCredential.nonce,
      organizationCredentialKeyVersion: input.organizationCredentialKeyVersion,
      intendedFamilyId: input.familyId,
      ...(input.credentialMetadata === undefined ? {} : { metadata: input.credentialMetadata }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    })
    .returning({
      id: tables.integrationCredentials.id,
    });

  if (createdCredential === undefined) {
    throw new Error("Failed to create OAuth 2.0 (Authorization Code) credential.");
  }

  await input.tx
    .insert(tables.integrationConnectionCredentials)
    .values({
      connectionId: input.connectionId,
      credentialId: createdCredential.id,
      slotKey: input.slotKey,
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

  if (existingLink !== undefined && existingLink.credentialId !== createdCredential.id) {
    await input.tx
      .update(tables.integrationCredentials)
      .set({
        revokedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.integrationCredentials.id, existingLink.credentialId),
          isNull(tables.integrationCredentials.revokedAt),
        ),
      );
  }
}

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
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "invalidateIntegrationConnectionCredentialCache"
    >;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: CompleteOAuth2AuthorizationCodeConnectionInput,
): Promise<CompletedConnection> {
  const { db, dataPlaneClient, integrationRegistry, integrationsConfig } = ctx;

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

  const completedConnection = await db.transaction<CompletedConnection>(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const usedAtTimestamp = new Date().toISOString();
    const consumedSessionRows = await tx
      .update(tables.integrationConnectionRedirectSessions)
      .set({
        usedAt: usedAtTimestamp,
      })
      .where(
        and(
          eq(tables.integrationConnectionRedirectSessions.id, redirectSession.id),
          isNull(tables.integrationConnectionRedirectSessions.usedAt),
        ),
      )
      .returning({
        id: tables.integrationConnectionRedirectSessions.id,
      });

    if (consumedSessionRows.length !== 1) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
        "Redirect state has already been used.",
      );
    }

    if (redirectSession.intent === IntegrationConnectionRedirectSessionIntents.REAUTHORIZE) {
      const reauthorizedConnectionId = redirectSession.connectionId;
      if (reauthorizedConnectionId === null) {
        throw new Error(
          "OAuth 2.0 (Authorization Code) reauthorization session is missing a connection id.",
        );
      }

      const existingConnection = await tx.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.id, reauthorizedConnectionId),
            eq(table.organizationId, redirectSession.organizationId),
            eq(table.targetKey, input.targetKey),
          ),
      });

      if (existingConnection === undefined) {
        throw new BadRequestError(
          IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
          "Redirect state references a connection that is no longer available.",
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

        await createAndLinkOAuth2Credential({
          tx,
          organizationId: redirectSession.organizationId,
          familyId: resolved.target.familyId,
          connectionId: existingConnection.id,
          slotKey: oauth2AuthorizationCodeSlotKeys.accessToken,
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          plaintext: completedOAuth2AuthorizationCodeConnection.accessToken,
          organizationCredentialKeyVersion: organizationCredentialKey.version,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
          ...(completedOAuth2AuthorizationCodeConnection.credentialMetadata === undefined
            ? {}
            : {
                credentialMetadata: completedOAuth2AuthorizationCodeConnection.credentialMetadata,
              }),
          ...(completedOAuth2AuthorizationCodeConnection.accessTokenExpiresAt === undefined
            ? {}
            : { expiresAt: completedOAuth2AuthorizationCodeConnection.accessTokenExpiresAt }),
        });

        if (completedOAuth2AuthorizationCodeConnection.refreshToken === undefined) {
          await revokeLinkedCredentialSlot({
            tx,
            connectionId: existingConnection.id,
            slotKey: oauth2AuthorizationCodeSlotKeys.refreshToken,
          });
        } else {
          await createAndLinkOAuth2Credential({
            tx,
            organizationId: redirectSession.organizationId,
            familyId: resolved.target.familyId,
            connectionId: existingConnection.id,
            slotKey: oauth2AuthorizationCodeSlotKeys.refreshToken,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
            plaintext: completedOAuth2AuthorizationCodeConnection.refreshToken,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            organizationCredentialKey: unwrappedOrganizationCredentialKey,
            ...(completedOAuth2AuthorizationCodeConnection.credentialMetadata === undefined
              ? {}
              : {
                  credentialMetadata: completedOAuth2AuthorizationCodeConnection.credentialMetadata,
                }),
            ...(completedOAuth2AuthorizationCodeConnection.refreshTokenExpiresAt === undefined
              ? {}
              : { expiresAt: completedOAuth2AuthorizationCodeConnection.refreshTokenExpiresAt }),
          });
        }

        if (completedOAuth2AuthorizationCodeConnection.clientSecret === undefined) {
          await revokeLinkedCredentialSlot({
            tx,
            connectionId: existingConnection.id,
            slotKey: oauth2AuthorizationCodeSlotKeys.clientSecret,
          });
        } else {
          await createAndLinkOAuth2Credential({
            tx,
            organizationId: redirectSession.organizationId,
            familyId: resolved.target.familyId,
            connectionId: existingConnection.id,
            slotKey: oauth2AuthorizationCodeSlotKeys.clientSecret,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
            plaintext: completedOAuth2AuthorizationCodeConnection.clientSecret,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            organizationCredentialKey: unwrappedOrganizationCredentialKey,
            ...(completedOAuth2AuthorizationCodeConnection.credentialMetadata === undefined
              ? {}
              : {
                  credentialMetadata: completedOAuth2AuthorizationCodeConnection.credentialMetadata,
                }),
          });
        }
      } finally {
        unwrappedOrganizationCredentialKey.fill(0);
      }

      const [updatedConnection] = await tx
        .update(tables.integrationConnections)
        .set({
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
          updatedAt: sql`now()`,
        })
        .where(eq(tables.integrationConnections.id, existingConnection.id))
        .returning();

      if (updatedConnection === undefined) {
        throw new Error(
          "Failed to update integration connection from OAuth 2.0 (Authorization Code) reauthorization callback.",
        );
      }

      return {
        id: updatedConnection.id,
        authorizationIntent: "reauthorize",
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
    }

    if (
      redirectSession.intent !== IntegrationConnectionRedirectSessionIntents.CREATE ||
      redirectSession.connectionId !== null
    ) {
      throw new Error("OAuth 2.0 (Authorization Code) redirect session has invalid create state.");
    }

    const [createdConnection] = await tx
      .insert(tables.integrationConnections)
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
        .insert(tables.integrationCredentials)
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
          id: tables.integrationCredentials.id,
        });

      if (createdAccessTokenCredential === undefined) {
        throw new Error("Failed to create OAuth 2.0 (Authorization Code) access token credential.");
      }

      const [createdAccessTokenCredentialLink] = await tx
        .insert(tables.integrationConnectionCredentials)
        .values({
          connectionId: createdConnection.id,
          credentialId: createdAccessTokenCredential.id,
          slotKey: oauth2AuthorizationCodeSlotKeys.accessToken,
        })
        .returning({
          connectionId: tables.integrationConnectionCredentials.connectionId,
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
          .insert(tables.integrationCredentials)
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
            id: tables.integrationCredentials.id,
          });

        if (createdRefreshTokenCredential === undefined) {
          throw new Error(
            "Failed to create OAuth 2.0 (Authorization Code) refresh token credential.",
          );
        }

        const [createdRefreshTokenCredentialLink] = await tx
          .insert(tables.integrationConnectionCredentials)
          .values({
            connectionId: createdConnection.id,
            credentialId: createdRefreshTokenCredential.id,
            slotKey: oauth2AuthorizationCodeSlotKeys.refreshToken,
          })
          .returning({
            connectionId: tables.integrationConnectionCredentials.connectionId,
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
          .insert(tables.integrationCredentials)
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
            id: tables.integrationCredentials.id,
          });

        if (createdClientSecretCredential === undefined) {
          throw new Error(
            "Failed to create OAuth 2.0 (Authorization Code) client secret credential.",
          );
        }

        const [createdClientSecretCredentialLink] = await tx
          .insert(tables.integrationConnectionCredentials)
          .values({
            connectionId: createdConnection.id,
            credentialId: createdClientSecretCredential.id,
            slotKey: oauth2AuthorizationCodeSlotKeys.clientSecret,
          })
          .returning({
            connectionId: tables.integrationConnectionCredentials.connectionId,
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
      authorizationIntent: "create",
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

  if (completedConnection.authorizationIntent === "reauthorize") {
    await dataPlaneClient
      .invalidateIntegrationConnectionCredentialCache({
        connectionId: completedConnection.id,
      })
      .catch((error: unknown) => {
        logger.warn(
          {
            err: error,
            connectionId: completedConnection.id,
            reason: "oauth2_authorization_code_reauthorize",
          },
          "Failed to invalidate gateway credential cache",
        );
      });
  }

  return completedConnection;
}
