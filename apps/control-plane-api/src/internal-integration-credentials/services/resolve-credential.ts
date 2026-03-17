import {
  integrationConnectionCredentials,
  IntegrationConnectionCredentialPurposes,
  type IntegrationConnectionCredentialPurpose,
  integrationConnections,
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  integrationCredentials,
  type IntegrationBindingKind,
  type IntegrationTarget,
  type IntegrationCredentialSecretKind,
  sandboxProfileVersionIntegrationBindings,
} from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethodId,
  type IntegrationOAuth2Capability,
  IntegrationOAuth2RefreshAccessTokenError,
  IntegrationOAuth2RefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  encryptCredentialUtf8,
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../integration-credentials/crypto.js";
import { resolveIntegrationTargetSecrets } from "../../integration-targets/services/resolve-target-secrets.js";
import type { AppContext } from "../../types.js";
import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "./errors.js";

export type ResolveIntegrationCredentialInput = {
  connectionId: string;
  bindingId?: string;
  secretType: string;
  purpose?: string | undefined;
  resolverKey?: string | undefined;
};

export type ResolvedIntegrationCredential = {
  value: string;
  expiresAt?: string;
};

type ResolvePersistedCredentialInput = {
  db: AppContext["var"]["db"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connectionId: string;
  secretType: string;
  purpose?: string | undefined;
};

type LinkedActiveCredential = {
  credentialId: string;
  ciphertext: string;
  nonce: string;
  organizationCredentialKeyVersion: number;
  expiresAt: string | null;
};

type ResolverContextConnection = {
  id: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config: Record<string, unknown>;
};

type ResolverContextTarget = {
  familyId: string;
  variantId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

type ResolverContextBinding = {
  id: string;
  kind: IntegrationBindingKind;
  config: Record<string, unknown>;
};

type OAuth2ManagedCredentialResolution =
  | {
      kind: "resolved";
      credential: ResolvedIntegrationCredential;
    }
  | {
      kind: "refresh-failed";
      message: string;
    };

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const StringRecordSchema = z.record(z.string(), z.string());

function resolveConnectionConfigOrThrow(input: {
  connectionId: string;
  config: unknown;
}): Record<string, unknown> {
  const parsedConfig = UnknownRecordSchema.safeParse(input.config);
  if (!parsedConfig.success) {
    throw new Error(`Integration connection '${input.connectionId}' has invalid config.`);
  }

  return parsedConfig.data;
}

function resolveResolverContextConnection(input: {
  id: string;
  status: "active" | "error" | "revoked";
  externalSubjectId: string | null;
  config: unknown;
}): ResolverContextConnection {
  const config = resolveConnectionConfigOrThrow({
    connectionId: input.id,
    config: input.config,
  });

  return {
    id: input.id,
    status: input.status,
    config,
    ...(input.externalSubjectId === null ? {} : { externalSubjectId: input.externalSubjectId }),
  };
}

function resolveResolverContextTarget(input: {
  target: Pick<
    IntegrationTarget,
    "targetKey" | "familyId" | "variantId" | "enabled" | "config" | "secrets"
  >;
  definition: {
    targetConfigSchema: {
      parse: (input: unknown) => unknown;
    };
    targetSecretSchema: {
      parse: (input: unknown) => unknown;
    };
  };
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): ResolverContextTarget {
  const parsedTargetConfigOutput = input.definition.targetConfigSchema.parse(input.target.config);
  const parsedTargetConfig = UnknownRecordSchema.safeParse(parsedTargetConfigOutput);
  if (!parsedTargetConfig.success) {
    throw new Error(
      `Integration target '${input.target.targetKey}' has invalid parsed target config.`,
    );
  }

  const decryptedTargetSecrets = resolveIntegrationTargetSecrets({
    integrationsConfig: input.integrationsConfig,
    target: {
      targetKey: input.target.targetKey,
      secrets: input.target.secrets,
    },
  });
  const parsedTargetSecretsOutput =
    input.definition.targetSecretSchema.parse(decryptedTargetSecrets);
  const parsedTargetSecrets = StringRecordSchema.safeParse(parsedTargetSecretsOutput);
  if (!parsedTargetSecrets.success) {
    throw new Error(
      `Integration target '${input.target.targetKey}' has invalid parsed target secrets.`,
    );
  }

  return {
    familyId: input.target.familyId,
    variantId: input.target.variantId,
    enabled: input.target.enabled,
    config: parsedTargetConfig.data,
    secrets: parsedTargetSecrets.data,
  };
}

function resolveResolverContextBinding(input: {
  binding: {
    id: string;
    kind: IntegrationBindingKind;
    config: unknown;
  };
  definition: {
    bindingConfigSchema: {
      parse: (input: unknown) => unknown;
    };
  };
}): ResolverContextBinding {
  const parsedBindingConfigOutput = input.definition.bindingConfigSchema.parse(
    input.binding.config,
  );
  const parsedBindingConfig = UnknownRecordSchema.safeParse(parsedBindingConfigOutput);
  if (!parsedBindingConfig.success) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.INVALID_BINDING_CONFIG,
      400,
      `Integration binding '${input.binding.id}' has invalid parsed binding config.`,
    );
  }

  return {
    id: input.binding.id,
    kind: input.binding.kind,
    config: parsedBindingConfig.data,
  };
}

function parsePersistedSecretType(secretType: string): IntegrationCredentialSecretKind | undefined {
  if (secretType === IntegrationCredentialSecretKinds.API_KEY) {
    return IntegrationCredentialSecretKinds.API_KEY;
  }

  if (secretType === IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN) {
    return IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN;
  }

  if (secretType === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN) {
    return IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN;
  }

  return undefined;
}

function parsePersistedCredentialPurpose(
  purpose: string | undefined,
): IntegrationConnectionCredentialPurpose | undefined {
  if (purpose === undefined) {
    return undefined;
  }

  if (purpose === IntegrationConnectionCredentialPurposes.API_KEY) {
    return IntegrationConnectionCredentialPurposes.API_KEY;
  }

  if (purpose === IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN) {
    return IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN;
  }

  if (purpose === IntegrationConnectionCredentialPurposes.OAUTH2_REFRESH_TOKEN) {
    return IntegrationConnectionCredentialPurposes.OAUTH2_REFRESH_TOKEN;
  }

  return undefined;
}

function normalizeCredentialExpiryOrThrow(expiresAt: string): string {
  const epochMilliseconds = Date.parse(expiresAt);
  if (Number.isNaN(epochMilliseconds)) {
    throw new Error(`Persisted credential expiry timestamp '${expiresAt}' is invalid.`);
  }

  return new Date(epochMilliseconds).toISOString();
}

function resolveConnectionMethodId(
  connectionConfig: Record<string, unknown>,
): IntegrationConnectionMethodId | undefined {
  const connectionMethod = connectionConfig["connection_method"];
  if (connectionMethod === IntegrationConnectionMethodIds.API_KEY) {
    return IntegrationConnectionMethodIds.API_KEY;
  }

  if (connectionMethod === IntegrationConnectionMethodIds.OAUTH2) {
    return IntegrationConnectionMethodIds.OAUTH2;
  }

  if (connectionMethod === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION) {
    return IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION;
  }

  return undefined;
}

function isCredentialExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) {
    return false;
  }

  const normalizedExpiry = normalizeCredentialExpiryOrThrow(expiresAt);
  return Date.parse(normalizedExpiry) <= Date.now();
}

async function resolveLinkedActiveCredential(
  db: AppContext["var"]["db"],
  input: {
    connectionId: string;
    purpose: IntegrationConnectionCredentialPurpose;
    secretKind: IntegrationCredentialSecretKind;
  },
): Promise<LinkedActiveCredential | undefined> {
  const linkedCredential = await db.query.integrationConnectionCredentials.findFirst({
    columns: {
      credentialId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.connectionId, input.connectionId), eq(table.purpose, input.purpose)),
  });

  if (linkedCredential === undefined) {
    return undefined;
  }

  const credential = await db.query.integrationCredentials.findFirst({
    columns: {
      id: true,
      ciphertext: true,
      nonce: true,
      organizationCredentialKeyVersion: true,
      expiresAt: true,
    },
    where: (table, { and, eq, isNull }) =>
      and(
        eq(table.id, linkedCredential.credentialId),
        eq(table.secretKind, input.secretKind),
        isNull(table.revokedAt),
      ),
  });

  if (credential === undefined) {
    return undefined;
  }

  return {
    credentialId: credential.id,
    ciphertext: credential.ciphertext,
    nonce: credential.nonce,
    organizationCredentialKeyVersion: credential.organizationCredentialKeyVersion,
    expiresAt: credential.expiresAt,
  };
}

async function decryptLinkedActiveCredential(
  db: AppContext["var"]["db"],
  input: {
    organizationId: string;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    credential: LinkedActiveCredential;
  },
): Promise<ResolvedIntegrationCredential> {
  const organizationCredentialKey = await db.query.organizationCredentialKeys.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.version, input.credential.organizationCredentialKeyVersion),
      ),
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Organization credential key version '${String(input.credential.organizationCredentialKeyVersion)}' for organization '${input.organizationId}' was not found.`,
    );
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const value = decryptCredentialUtf8({
      nonce: input.credential.nonce,
      ciphertext: input.credential.ciphertext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    return {
      value,
      ...(input.credential.expiresAt === null
        ? {}
        : { expiresAt: normalizeCredentialExpiryOrThrow(input.credential.expiresAt) }),
    };
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

async function markConnectionAsError(
  db: AppContext["var"]["db"],
  connectionId: string,
): Promise<void> {
  await db
    .update(integrationConnections)
    .set({
      status: IntegrationConnectionStatuses.ERROR,
      updatedAt: sql`now()`,
    })
    .where(eq(integrationConnections.id, connectionId));
}

function createOAuth2RefreshFailedError(message: string): InternalIntegrationCredentialsError {
  return new InternalIntegrationCredentialsError(
    InternalIntegrationCredentialsErrorCodes.OAUTH2_REFRESH_FAILED,
    400,
    message,
  );
}

async function resolveOAuth2ManagedCredential(input: {
  db: AppContext["var"]["db"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  connection: {
    id: string;
    organizationId: string;
    targetKey: string;
    externalSubjectId: string | null;
    config: unknown;
  };
  target: ResolverContextTarget;
  oauth2: IntegrationOAuth2Capability<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>
  >;
  secretType: string;
  purpose?: string;
}): Promise<ResolvedIntegrationCredential> {
  const parsedPurpose = parsePersistedCredentialPurpose(input.purpose);
  if (input.purpose !== undefined && parsedPurpose === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No linked integration credential was found for this purpose.",
    );
  }

  if (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN) {
    return resolvePersistedCredential({
      db: input.db,
      integrationsConfig: input.integrationsConfig,
      organizationId: input.connection.organizationId,
      connectionId: input.connection.id,
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  if (
    input.secretType !== IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN ||
    (parsedPurpose !== undefined &&
      parsedPurpose !== IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN)
  ) {
    return resolvePersistedCredential({
      db: input.db,
      integrationsConfig: input.integrationsConfig,
      organizationId: input.connection.organizationId,
      connectionId: input.connection.id,
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  const resolution = await input.db.transaction<OAuth2ManagedCredentialResolution>(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.connection.organizationId}), hashtext(${input.connection.id}))`,
    );

    const lockedConnection = await tx.query.integrationConnections.findFirst({
      columns: {
        id: true,
        organizationId: true,
        targetKey: true,
        status: true,
        externalSubjectId: true,
        config: true,
      },
      where: (table, { eq }) => eq(table.id, input.connection.id),
    });

    if (lockedConnection === undefined) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.CONNECTION_NOT_FOUND,
        404,
        `Integration connection '${input.connection.id}' was not found.`,
      );
    }

    if (lockedConnection.status !== IntegrationConnectionStatuses.ACTIVE) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.CONNECTION_NOT_ACTIVE,
        400,
        `Integration connection '${lockedConnection.id}' is not active.`,
      );
    }

    const lockedConnectionResolverContext = resolveResolverContextConnection({
      id: lockedConnection.id,
      status: lockedConnection.status,
      externalSubjectId: lockedConnection.externalSubjectId,
      config: lockedConnection.config,
    });

    const accessCredential = await resolveLinkedActiveCredential(tx, {
      connectionId: lockedConnection.id,
      purpose: IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN,
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
    });

    if (accessCredential !== undefined && !isCredentialExpired(accessCredential.expiresAt)) {
      return {
        kind: "resolved",
        credential: await decryptLinkedActiveCredential(tx, {
          organizationId: lockedConnection.organizationId,
          integrationsConfig: input.integrationsConfig,
          credential: accessCredential,
        }),
      };
    }

    const refreshCredential = await resolveLinkedActiveCredential(tx, {
      connectionId: lockedConnection.id,
      purpose: IntegrationConnectionCredentialPurposes.OAUTH2_REFRESH_TOKEN,
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
    });

    if (refreshCredential === undefined) {
      await markConnectionAsError(tx, lockedConnection.id);
      return {
        kind: "refresh-failed",
        message: `OAuth2 access token for connection '${lockedConnection.id}' is not usable and no active refresh token is available.`,
      };
    }

    if (isCredentialExpired(refreshCredential.expiresAt)) {
      await markConnectionAsError(tx, lockedConnection.id);
      return {
        kind: "refresh-failed",
        message: `OAuth2 refresh token for connection '${lockedConnection.id}' has expired.`,
      };
    }

    const decryptedRefreshToken = await decryptLinkedActiveCredential(tx, {
      organizationId: lockedConnection.organizationId,
      integrationsConfig: input.integrationsConfig,
      credential: refreshCredential,
    });

    let refreshedAccessToken;
    try {
      refreshedAccessToken = await input.oauth2.refreshAccessToken({
        organizationId: lockedConnection.organizationId,
        targetKey: lockedConnection.targetKey,
        target: input.target,
        connection: lockedConnectionResolverContext,
        refreshToken: decryptedRefreshToken.value,
      });
    } catch (error) {
      if (error instanceof IntegrationOAuth2RefreshAccessTokenError) {
        if (
          error.classification === IntegrationOAuth2RefreshAccessTokenErrorClassifications.PERMANENT
        ) {
          await markConnectionAsError(tx, lockedConnection.id);
        }

        return {
          kind: "refresh-failed",
          message: error.message,
        };
      }

      throw error;
    }

    const latestOrganizationCredentialKey = await tx.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, lockedConnection.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });

    if (latestOrganizationCredentialKey === undefined) {
      throw new Error(
        `Organization credential key is missing for '${lockedConnection.organizationId}'.`,
      );
    }

    const latestMasterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: latestOrganizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
    });
    const latestUnwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
      wrappedCiphertext: latestOrganizationCredentialKey.ciphertext,
      masterEncryptionKeyMaterial: latestMasterEncryptionKeyMaterial,
    });

    try {
      const encryptedAccessToken = encryptCredentialUtf8({
        plaintext: refreshedAccessToken.accessToken,
        organizationCredentialKey: latestUnwrappedOrganizationCredentialKey,
      });

      const [createdAccessTokenCredential] = await tx
        .insert(integrationCredentials)
        .values({
          organizationId: lockedConnection.organizationId,
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          ciphertext: encryptedAccessToken.ciphertext,
          nonce: encryptedAccessToken.nonce,
          organizationCredentialKeyVersion: latestOrganizationCredentialKey.version,
          intendedFamilyId: input.target.familyId,
          ...(refreshedAccessToken.credentialMetadata === undefined
            ? {}
            : { metadata: refreshedAccessToken.credentialMetadata }),
          ...(refreshedAccessToken.accessTokenExpiresAt === undefined
            ? {}
            : { expiresAt: refreshedAccessToken.accessTokenExpiresAt }),
        })
        .returning({
          id: integrationCredentials.id,
        });

      if (createdAccessTokenCredential === undefined) {
        throw new Error("Failed to create refreshed OAuth2 access token credential.");
      }

      await tx
        .insert(integrationConnectionCredentials)
        .values({
          connectionId: lockedConnection.id,
          credentialId: createdAccessTokenCredential.id,
          purpose: IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN,
        })
        .onConflictDoUpdate({
          target: [
            integrationConnectionCredentials.connectionId,
            integrationConnectionCredentials.purpose,
          ],
          set: {
            credentialId: createdAccessTokenCredential.id,
          },
        });

      if (
        accessCredential !== undefined &&
        accessCredential.credentialId !== createdAccessTokenCredential.id
      ) {
        await tx
          .update(integrationCredentials)
          .set({
            revokedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(integrationCredentials.id, accessCredential.credentialId),
              isNull(integrationCredentials.revokedAt),
            ),
          );
      }

      if (refreshedAccessToken.refreshToken !== undefined) {
        const encryptedRefreshToken = encryptCredentialUtf8({
          plaintext: refreshedAccessToken.refreshToken,
          organizationCredentialKey: latestUnwrappedOrganizationCredentialKey,
        });

        const [createdRefreshTokenCredential] = await tx
          .insert(integrationCredentials)
          .values({
            organizationId: lockedConnection.organizationId,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
            ciphertext: encryptedRefreshToken.ciphertext,
            nonce: encryptedRefreshToken.nonce,
            organizationCredentialKeyVersion: latestOrganizationCredentialKey.version,
            intendedFamilyId: input.target.familyId,
            ...(refreshedAccessToken.credentialMetadata === undefined
              ? {}
              : { metadata: refreshedAccessToken.credentialMetadata }),
            ...(refreshedAccessToken.refreshTokenExpiresAt === undefined
              ? {}
              : { expiresAt: refreshedAccessToken.refreshTokenExpiresAt }),
          })
          .returning({
            id: integrationCredentials.id,
          });

        if (createdRefreshTokenCredential === undefined) {
          throw new Error("Failed to create refreshed OAuth2 refresh token credential.");
        }

        await tx
          .insert(integrationConnectionCredentials)
          .values({
            connectionId: lockedConnection.id,
            credentialId: createdRefreshTokenCredential.id,
            purpose: IntegrationConnectionCredentialPurposes.OAUTH2_REFRESH_TOKEN,
          })
          .onConflictDoUpdate({
            target: [
              integrationConnectionCredentials.connectionId,
              integrationConnectionCredentials.purpose,
            ],
            set: {
              credentialId: createdRefreshTokenCredential.id,
            },
          });

        if (refreshCredential.credentialId !== createdRefreshTokenCredential.id) {
          await tx
            .update(integrationCredentials)
            .set({
              revokedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(integrationCredentials.id, refreshCredential.credentialId),
                isNull(integrationCredentials.revokedAt),
              ),
            );
        }
      }
    } finally {
      latestUnwrappedOrganizationCredentialKey.fill(0);
    }

    return {
      kind: "resolved",
      credential: {
        value: refreshedAccessToken.accessToken,
        ...(refreshedAccessToken.accessTokenExpiresAt === undefined
          ? {}
          : { expiresAt: refreshedAccessToken.accessTokenExpiresAt }),
      },
    };
  });

  if (resolution.kind === "refresh-failed") {
    throw createOAuth2RefreshFailedError(resolution.message);
  }

  return resolution.credential;
}

async function resolvePersistedCredential(
  input: ResolvePersistedCredentialInput,
): Promise<ResolvedIntegrationCredential> {
  const credentialPurpose = parsePersistedCredentialPurpose(input.purpose);
  if (input.purpose !== undefined && credentialPurpose === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No linked integration credential was found for this purpose.",
    );
  }

  const linkedCredentials = await input.db.query.integrationConnectionCredentials.findMany({
    columns: {
      credentialId: true,
      purpose: true,
    },
    where: (table, { and, eq }) => {
      const connectionFilter = eq(table.connectionId, input.connectionId);
      if (credentialPurpose === undefined) {
        return connectionFilter;
      }

      return and(connectionFilter, eq(table.purpose, credentialPurpose));
    },
  });

  if (linkedCredentials.length === 0) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No linked integration credential was found for this connection.",
    );
  }

  const matchedCredentials: Array<{
    id: string;
    ciphertext: string;
    nonce: string;
    organizationCredentialKeyVersion: number;
    expiresAt: string | null;
  }> = [];
  const persistedSecretType = parsePersistedSecretType(input.secretType);
  if (persistedSecretType === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No active integration credential was found for this secret type.",
    );
  }

  for (const linkedCredential of linkedCredentials) {
    const credential = await input.db.query.integrationCredentials.findFirst({
      columns: {
        id: true,
        ciphertext: true,
        nonce: true,
        organizationCredentialKeyVersion: true,
        expiresAt: true,
      },
      where: (table, { and, eq, isNull }) =>
        and(
          eq(table.id, linkedCredential.credentialId),
          eq(table.secretKind, persistedSecretType),
          isNull(table.revokedAt),
        ),
    });

    if (credential !== undefined) {
      matchedCredentials.push(credential);
    }
  }

  if (matchedCredentials.length === 0) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No active integration credential was found for this secret type.",
    );
  }

  if (matchedCredentials.length > 1) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.AMBIGUOUS_CREDENTIAL_MATCH,
      400,
      "Multiple credentials matched. Provide a specific purpose for credential resolution.",
    );
  }

  const credential = matchedCredentials[0];
  if (credential === undefined) {
    throw new Error("Expected matched credential to exist.");
  }

  const organizationCredentialKey = await input.db.query.organizationCredentialKeys.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.version, credential.organizationCredentialKeyVersion),
      ),
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Organization credential key version '${String(credential.organizationCredentialKeyVersion)}' for organization '${input.organizationId}' was not found.`,
    );
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const value = decryptCredentialUtf8({
      nonce: credential.nonce,
      ciphertext: credential.ciphertext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    return {
      value,
      ...(credential.expiresAt === null
        ? {}
        : { expiresAt: normalizeCredentialExpiryOrThrow(credential.expiresAt) }),
    };
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

export async function resolveIntegrationCredential(
  db: AppContext["var"]["db"],
  integrationRegistry: AppContext["var"]["integrationRegistry"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: ResolveIntegrationCredentialInput,
): Promise<ResolvedIntegrationCredential> {
  const connection = await db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      organizationId: true,
      targetKey: true,
      status: true,
      externalSubjectId: true,
      config: true,
    },
    where: (table, { eq }) => eq(table.id, input.connectionId),
  });

  if (connection === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CONNECTION_NOT_FOUND,
      404,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CONNECTION_NOT_ACTIVE,
      400,
      `Integration connection '${connection.id}' is not active.`,
    );
  }

  const target = await db.query.integrationTargets.findFirst({
    columns: {
      targetKey: true,
      familyId: true,
      variantId: true,
      enabled: true,
      config: true,
      secrets: true,
    },
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });

  if (target === undefined) {
    throw new Error(`Integration target '${connection.targetKey}' was not found.`);
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}::${target.variantId}' was not found.`,
    );
  }

  let bindingResolverContext: ResolverContextBinding | undefined;
  if (input.bindingId !== undefined) {
    const [binding] = await db
      .select({
        id: sandboxProfileVersionIntegrationBindings.id,
        kind: sandboxProfileVersionIntegrationBindings.kind,
        connectionId: sandboxProfileVersionIntegrationBindings.connectionId,
        config: sandboxProfileVersionIntegrationBindings.config,
      })
      .from(sandboxProfileVersionIntegrationBindings)
      .where(eq(sandboxProfileVersionIntegrationBindings.id, input.bindingId))
      .limit(1);

    if (binding === undefined) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.BINDING_NOT_FOUND,
        404,
        `Integration binding '${input.bindingId}' was not found.`,
      );
    }

    if (binding.connectionId !== connection.id) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.BINDING_CONNECTION_MISMATCH,
        400,
        `Integration binding '${binding.id}' does not belong to connection '${connection.id}'.`,
      );
    }

    bindingResolverContext = resolveResolverContextBinding({
      binding: {
        id: binding.id,
        kind: binding.kind,
        config: binding.config,
      },
      definition,
    });
  }

  const connectionResolverContext = resolveResolverContextConnection({
    id: connection.id,
    status: connection.status,
    externalSubjectId: connection.externalSubjectId,
    config: connection.config,
  });
  const connectionMethodId = resolveConnectionMethodId(connectionResolverContext.config);

  if (input.resolverKey !== undefined) {
    const customResolver = definition.credentialResolvers?.custom?.[input.resolverKey];
    if (customResolver === undefined) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.RESOLVER_NOT_FOUND,
        404,
        `Credential resolver '${input.resolverKey}' was not found for target '${connection.targetKey}'.`,
      );
    }

    const targetResolverContext = resolveResolverContextTarget({
      target,
      definition,
      integrationsConfig,
    });

    return customResolver.resolve({
      organizationId: connection.organizationId,
      targetKey: connection.targetKey,
      connectionId: connection.id,
      target: targetResolverContext,
      connection: connectionResolverContext,
      ...(bindingResolverContext === undefined ? {} : { binding: bindingResolverContext }),
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  if (
    connectionMethodId === IntegrationConnectionMethodIds.OAUTH2 &&
    definition.oauth2 !== undefined &&
    (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN ||
      input.secretType === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN)
  ) {
    const targetResolverContext = resolveResolverContextTarget({
      target,
      definition,
      integrationsConfig,
    });

    return resolveOAuth2ManagedCredential({
      db,
      integrationsConfig,
      connection: {
        id: connection.id,
        organizationId: connection.organizationId,
        targetKey: connection.targetKey,
        externalSubjectId: connection.externalSubjectId,
        config: connection.config,
      },
      target: targetResolverContext,
      oauth2: definition.oauth2,
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  const defaultResolver = definition.credentialResolvers?.default;
  if (defaultResolver !== undefined) {
    const targetResolverContext = resolveResolverContextTarget({
      target,
      definition,
      integrationsConfig,
    });

    return defaultResolver.resolve({
      organizationId: connection.organizationId,
      targetKey: connection.targetKey,
      connectionId: connection.id,
      target: targetResolverContext,
      connection: connectionResolverContext,
      ...(bindingResolverContext === undefined ? {} : { binding: bindingResolverContext }),
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  return resolvePersistedCredential({
    db,
    integrationsConfig,
    organizationId: connection.organizationId,
    connectionId: connection.id,
    secretType: input.secretType,
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
  });
}
