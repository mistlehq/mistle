import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  type IntegrationBindingKind,
  type IntegrationTarget,
  type IntegrationCredentialSecretKind,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  type IntegrationCredentialResolverResult,
  type IntegrationOAuth2AuthorizationCodeCapability,
  type IntegrationOAuth2ClientCredentialsCapability,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { SpanStatusCode, type Span, trace } from "@opentelemetry/api";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  encryptCredentialUtf8,
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../../lib/crypto.js";
import { resolveIntegrationTargetSecrets } from "../../../lib/integration-target-secrets.js";
import { logger } from "../../../logger.js";
import type { AppContext } from "../../../types.js";
import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "./errors.js";

export type ResolveIntegrationCredentialInput = {
  connectionId: string;
  bindingId?: string;
  secretType: string;
  slotKey?: string | undefined;
  resolverKey?: string | undefined;
};

export type ResolvedIntegrationCredential = IntegrationCredentialResolverResult;

type ResolvePersistedCredentialInput = {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connectionId: string;
  secretType: string;
  slotKey?: string | undefined;
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
  secrets?: Record<string, string>;
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

type OAuth2AuthorizationCodeManagedCredentialResolution =
  | {
      kind: "resolved";
      credential: ResolvedIntegrationCredential;
    }
  | {
      kind: "refresh-failed";
      message: string;
    };

type OAuth2ClientCredentialsManagedCredentialResolution = {
  credential: ResolvedIntegrationCredential;
};

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const StringRecordSchema = z.record(z.string(), z.string());
const ResolveIntegrationCredentialTracer = trace.getTracer("@mistle/control-plane-api");

function createResolveCredentialTelemetryAttributes(input: {
  connectionId: string;
  bindingId?: string;
  targetKey?: string;
  familyId?: string;
  variantId?: string;
  connectionMethod?: string;
  secretType: string;
  slotKey?: string;
  resolverKey?: string;
  hasBindingContext: boolean;
  hasHydratedConnectionSecrets?: boolean;
}): Record<string, string | boolean> {
  return {
    "mistle.integration.connection_id": input.connectionId,
    "mistle.integration.resolve.has_binding_context": input.hasBindingContext,
    "mistle.integration.credential.secret_type": input.secretType,
    ...(input.bindingId === undefined ? {} : { "mistle.integration.binding_id": input.bindingId }),
    ...(input.targetKey === undefined ? {} : { "mistle.integration.target_key": input.targetKey }),
    ...(input.familyId === undefined ? {} : { "mistle.integration.family_id": input.familyId }),
    ...(input.variantId === undefined ? {} : { "mistle.integration.variant_id": input.variantId }),
    ...(input.connectionMethod === undefined
      ? {}
      : { "mistle.integration.connection_method": input.connectionMethod }),
    ...(input.slotKey === undefined
      ? {}
      : { "mistle.integration.credential.slot_key": input.slotKey }),
    ...(input.resolverKey === undefined
      ? {}
      : { "mistle.integration.credential.resolver_key": input.resolverKey }),
    ...(input.hasHydratedConnectionSecrets === undefined
      ? {}
      : {
          "mistle.integration.resolve.has_hydrated_connection_secrets":
            input.hasHydratedConnectionSecrets,
        }),
  };
}

function createValueCredential(input: {
  value: string;
  expiresAt?: string;
}): ResolvedIntegrationCredential {
  return {
    kind: "value",
    value: input.value,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  };
}

function resolveValueCredentialValueOrThrow(
  credential: ResolvedIntegrationCredential,
  context: string,
): string {
  if (credential.kind !== "value") {
    throw new Error(`${context} requires a string credential value.`);
  }

  return credential.value;
}

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
  secrets?: Record<string, string>;
}): ResolverContextConnection {
  const config = resolveConnectionConfigOrThrow({
    connectionId: input.id,
    config: input.config,
  });

  return {
    id: input.id,
    status: input.status,
    config,
    ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
    ...(input.externalSubjectId === null ? {} : { externalSubjectId: input.externalSubjectId }),
  };
}

async function resolveResolverContextConnectionSecrets(input: {
  db: AppContext["var"]["db"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connectionId: string;
  connectionMethod?: {
    kind: "form";
    secretFields: readonly {
      name: string;
      optional?: boolean;
      secretType: string;
      slotKey: string;
    }[];
  };
}): Promise<Record<string, string> | undefined> {
  if (input.connectionMethod === undefined) {
    return undefined;
  }

  const resolvedSecrets = await Promise.all(
    input.connectionMethod.secretFields.map(async (field) => {
      let credential;
      try {
        credential = await resolvePersistedCredential({
          db: input.db,
          integrationsConfig: input.integrationsConfig,
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          secretType: field.secretType,
          slotKey: field.slotKey,
        });
      } catch (error) {
        if (
          field.optional === true &&
          error instanceof InternalIntegrationCredentialsError &&
          error.code === InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND
        ) {
          return undefined;
        }

        throw error;
      }

      return [
        field.name,
        resolveValueCredentialValueOrThrow(credential, "Connection secret hydration"),
      ] as const;
    }),
  );

  return Object.fromEntries(
    resolvedSecrets.filter((entry): entry is readonly [string, string] => entry !== undefined),
  );
}

async function resolveHydratedResolverContextConnection(input: {
  db: AppContext["var"]["db"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connection: {
    id: string;
    status: "active" | "error" | "revoked";
    externalSubjectId: string | null;
    config: unknown;
  };
  connectionMethod?: {
    kind: "form";
    secretFields: readonly {
      name: string;
      optional?: boolean;
      secretType: string;
      slotKey: string;
    }[];
  };
}): Promise<{
  connection: ResolverContextConnection;
  hasHydratedConnectionSecrets: boolean;
}> {
  const resolvedConnectionSecrets =
    input.connectionMethod === undefined
      ? undefined
      : await resolveResolverContextConnectionSecrets({
          db: input.db,
          integrationsConfig: input.integrationsConfig,
          organizationId: input.organizationId,
          connectionId: input.connection.id,
          connectionMethod: input.connectionMethod,
        });

  return {
    connection: resolveResolverContextConnection({
      id: input.connection.id,
      status: input.connection.status,
      externalSubjectId: input.connection.externalSubjectId,
      config: input.connection.config,
      ...(resolvedConnectionSecrets === undefined ? {} : { secrets: resolvedConnectionSecrets }),
    }),
    hasHydratedConnectionSecrets: resolvedConnectionSecrets !== undefined,
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

  if (secretType === IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY) {
    return IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY;
  }

  if (secretType === IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN) {
    return IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN;
  }

  if (secretType === IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET) {
    return IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET;
  }

  if (secretType === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN) {
    return IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN;
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
    slotKey: string;
    secretKind: IntegrationCredentialSecretKind;
  },
): Promise<LinkedActiveCredential | undefined> {
  const linkedCredential = await db.query.integrationConnectionCredentials.findFirst({
    columns: {
      credentialId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.connectionId, input.connectionId), eq(table.slotKey, input.slotKey)),
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

function resolvePersistedSlotKeyOrThrow(slotKey: string | undefined): string {
  if (slotKey === undefined || slotKey.length === 0) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.INVALID_RESOLVE_INPUT,
      400,
      "Persisted credential resolution requires `slotKey`.",
    );
  }

  return slotKey;
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

    return createValueCredential({
      value,
      ...(input.credential.expiresAt === null
        ? {}
        : { expiresAt: normalizeCredentialExpiryOrThrow(input.credential.expiresAt) }),
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

async function markConnectionAsError(
  db: AppContext["var"]["db"],
  connectionId: string,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(db);

  await db
    .update(tables.integrationConnections)
    .set({
      status: IntegrationConnectionStatuses.ERROR,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.integrationConnections.id, connectionId));
}

function createOAuth2AuthorizationCodeRefreshFailedError(
  message: string,
): InternalIntegrationCredentialsError {
  return new InternalIntegrationCredentialsError(
    InternalIntegrationCredentialsErrorCodes.OAUTH2_REFRESH_FAILED,
    400,
    message,
  );
}

async function resolveOAuth2AuthorizationCodeManagedCredential(input: {
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
  oauth2AuthorizationCode: IntegrationOAuth2AuthorizationCodeCapability<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>
  >;
  secretType: string;
  slotKey?: string;
  accessTokenSlotKey: string;
  refreshTokenSlotKey: string;
  clientSecretSlotKey: string;
}): Promise<ResolvedIntegrationCredential> {
  if (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN) {
    return resolvePersistedCredential({
      db: input.db,
      integrationsConfig: input.integrationsConfig,
      organizationId: input.connection.organizationId,
      connectionId: input.connection.id,
      secretType: input.secretType,
      ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
    });
  }

  if (
    input.secretType !== IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN ||
    input.slotKey !== input.accessTokenSlotKey
  ) {
    return resolvePersistedCredential({
      db: input.db,
      integrationsConfig: input.integrationsConfig,
      organizationId: input.connection.organizationId,
      connectionId: input.connection.id,
      secretType: input.secretType,
      ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
    });
  }

  const resolution = await input.db.transaction<OAuth2AuthorizationCodeManagedCredentialResolution>(
    async (tx) => {
      const tables = getControlPlaneDatabaseSchema(tx);

      const [lockedConnection] = await tx
        .select({
          id: tables.integrationConnections.id,
          organizationId: tables.integrationConnections.organizationId,
          targetKey: tables.integrationConnections.targetKey,
          status: tables.integrationConnections.status,
          externalSubjectId: tables.integrationConnections.externalSubjectId,
          config: tables.integrationConnections.config,
        })
        .from(tables.integrationConnections)
        .where(eq(tables.integrationConnections.id, input.connection.id))
        .limit(1)
        .for("update");

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
        slotKey: input.accessTokenSlotKey,
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
        slotKey: input.refreshTokenSlotKey,
        secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
      });

      if (refreshCredential === undefined) {
        await markConnectionAsError(tx, lockedConnection.id);
        return {
          kind: "refresh-failed",
          message: `OAuth 2.0 (Authorization Code) access token for connection '${lockedConnection.id}' is not usable and no active refresh token is available.`,
        };
      }

      if (isCredentialExpired(refreshCredential.expiresAt)) {
        await markConnectionAsError(tx, lockedConnection.id);
        return {
          kind: "refresh-failed",
          message: `OAuth 2.0 (Authorization Code) refresh token for connection '${lockedConnection.id}' has expired.`,
        };
      }

      const decryptedRefreshToken = await decryptLinkedActiveCredential(tx, {
        organizationId: lockedConnection.organizationId,
        integrationsConfig: input.integrationsConfig,
        credential: refreshCredential,
      });
      const clientSecretCredential = await resolveLinkedActiveCredential(tx, {
        connectionId: lockedConnection.id,
        slotKey: input.clientSecretSlotKey,
        secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      });
      const decryptedClientSecret =
        clientSecretCredential === undefined
          ? undefined
          : await decryptLinkedActiveCredential(tx, {
              organizationId: lockedConnection.organizationId,
              integrationsConfig: input.integrationsConfig,
              credential: clientSecretCredential,
            });

      let refreshedAccessToken;
      try {
        refreshedAccessToken = await input.oauth2AuthorizationCode.refreshAccessToken({
          organizationId: lockedConnection.organizationId,
          targetKey: lockedConnection.targetKey,
          target: input.target,
          connection: lockedConnectionResolverContext,
          refreshToken: resolveValueCredentialValueOrThrow(
            decryptedRefreshToken,
            "OAuth 2.0 refresh token resolution",
          ),
          ...(decryptedClientSecret === undefined
            ? {}
            : {
                clientSecret: resolveValueCredentialValueOrThrow(
                  decryptedClientSecret,
                  "OAuth 2.0 client secret resolution",
                ),
              }),
        });
      } catch (error) {
        if (error instanceof IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError) {
          if (
            error.classification ===
            IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT
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
          .insert(tables.integrationCredentials)
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
            id: tables.integrationCredentials.id,
          });

        if (createdAccessTokenCredential === undefined) {
          throw new Error("Failed to create refreshed OAuth2 access token credential.");
        }

        await tx
          .insert(tables.integrationConnectionCredentials)
          .values({
            connectionId: lockedConnection.id,
            credentialId: createdAccessTokenCredential.id,
            slotKey: input.accessTokenSlotKey,
          })
          .onConflictDoUpdate({
            target: [
              tables.integrationConnectionCredentials.connectionId,
              tables.integrationConnectionCredentials.slotKey,
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
            .update(tables.integrationCredentials)
            .set({
              revokedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(tables.integrationCredentials.id, accessCredential.credentialId),
                isNull(tables.integrationCredentials.revokedAt),
              ),
            );
        }

        if (refreshedAccessToken.refreshToken !== undefined) {
          const encryptedRefreshToken = encryptCredentialUtf8({
            plaintext: refreshedAccessToken.refreshToken,
            organizationCredentialKey: latestUnwrappedOrganizationCredentialKey,
          });

          const [createdRefreshTokenCredential] = await tx
            .insert(tables.integrationCredentials)
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
              id: tables.integrationCredentials.id,
            });

          if (createdRefreshTokenCredential === undefined) {
            throw new Error("Failed to create refreshed OAuth2 refresh token credential.");
          }

          await tx
            .insert(tables.integrationConnectionCredentials)
            .values({
              connectionId: lockedConnection.id,
              credentialId: createdRefreshTokenCredential.id,
              slotKey: input.refreshTokenSlotKey,
            })
            .onConflictDoUpdate({
              target: [
                tables.integrationConnectionCredentials.connectionId,
                tables.integrationConnectionCredentials.slotKey,
              ],
              set: {
                credentialId: createdRefreshTokenCredential.id,
              },
            });

          if (refreshCredential.credentialId !== createdRefreshTokenCredential.id) {
            await tx
              .update(tables.integrationCredentials)
              .set({
                revokedAt: sql`now()`,
                updatedAt: sql`now()`,
              })
              .where(
                and(
                  eq(tables.integrationCredentials.id, refreshCredential.credentialId),
                  isNull(tables.integrationCredentials.revokedAt),
                ),
              );
          }
        }
      } finally {
        latestUnwrappedOrganizationCredentialKey.fill(0);
      }

      return {
        kind: "resolved",
        credential: createValueCredential({
          value: refreshedAccessToken.accessToken,
          ...(refreshedAccessToken.accessTokenExpiresAt === undefined
            ? {}
            : { expiresAt: refreshedAccessToken.accessTokenExpiresAt }),
        }),
      };
    },
  );

  if (resolution.kind === "refresh-failed") {
    throw createOAuth2AuthorizationCodeRefreshFailedError(resolution.message);
  }

  return resolution.credential;
}

function resolveConnectionMethodId(config: Record<string, unknown>): string | undefined {
  const connectionMethod = config["connection_method"];
  if (typeof connectionMethod !== "string" || connectionMethod.length === 0) {
    return undefined;
  }

  return connectionMethod;
}

async function resolveOAuth2ClientCredentialsManagedCredential(input: {
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
  oauth2ClientCredentials: IntegrationOAuth2ClientCredentialsCapability<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>
  >;
  secretType: string;
  slotKey?: string;
  accessTokenSlotKey: string;
  clientSecretSlotKey: string;
}): Promise<ResolvedIntegrationCredential> {
  if (
    input.secretType !== IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN ||
    input.slotKey !== input.accessTokenSlotKey
  ) {
    return resolvePersistedCredential({
      db: input.db,
      integrationsConfig: input.integrationsConfig,
      organizationId: input.connection.organizationId,
      connectionId: input.connection.id,
      secretType: input.secretType,
      ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
    });
  }

  const resolution = await input.db.transaction<OAuth2ClientCredentialsManagedCredentialResolution>(
    async (tx) => {
      const tables = getControlPlaneDatabaseSchema(tx);

      const [lockedConnection] = await tx
        .select({
          id: tables.integrationConnections.id,
          organizationId: tables.integrationConnections.organizationId,
          targetKey: tables.integrationConnections.targetKey,
          status: tables.integrationConnections.status,
          externalSubjectId: tables.integrationConnections.externalSubjectId,
          config: tables.integrationConnections.config,
        })
        .from(tables.integrationConnections)
        .where(eq(tables.integrationConnections.id, input.connection.id))
        .limit(1)
        .for("update");

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

      const accessCredential = await resolveLinkedActiveCredential(tx, {
        connectionId: lockedConnection.id,
        slotKey: input.accessTokenSlotKey,
        secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      });
      const accessCredentialIsExpired =
        accessCredential === undefined ? false : isCredentialExpired(accessCredential.expiresAt);

      if (accessCredential !== undefined && !accessCredentialIsExpired) {
        return {
          credential: await decryptLinkedActiveCredential(tx, {
            organizationId: lockedConnection.organizationId,
            integrationsConfig: input.integrationsConfig,
            credential: accessCredential,
          }),
        };
      }

      const clientSecretCredential = await resolveLinkedActiveCredential(tx, {
        connectionId: lockedConnection.id,
        slotKey: input.clientSecretSlotKey,
        secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      });

      if (clientSecretCredential === undefined) {
        throw new InternalIntegrationCredentialsError(
          InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
          404,
          `OAuth 2.0 client secret for connection '${lockedConnection.id}' was not found.`,
        );
      }
      const clientSecretCredentialIsExpired = isCredentialExpired(clientSecretCredential.expiresAt);

      if (clientSecretCredentialIsExpired) {
        throw new InternalIntegrationCredentialsError(
          InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
          404,
          `OAuth 2.0 client secret for connection '${lockedConnection.id}' has expired.`,
        );
      }

      const connectionResolverContext = resolveResolverContextConnection({
        id: lockedConnection.id,
        status: lockedConnection.status,
        externalSubjectId: lockedConnection.externalSubjectId,
        config: lockedConnection.config,
      });

      const clientSecret = await decryptLinkedActiveCredential(tx, {
        organizationId: lockedConnection.organizationId,
        integrationsConfig: input.integrationsConfig,
        credential: clientSecretCredential,
      });

      const exchangedAccessToken = await input.oauth2ClientCredentials.exchangeClientCredentials({
        organizationId: lockedConnection.organizationId,
        targetKey: lockedConnection.targetKey,
        target: input.target,
        connection: connectionResolverContext,
        clientSecret: resolveValueCredentialValueOrThrow(
          clientSecret,
          "OAuth 2.0 client credentials exchange",
        ),
      });

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
          plaintext: exchangedAccessToken.accessToken,
          organizationCredentialKey: latestUnwrappedOrganizationCredentialKey,
        });

        const [createdAccessTokenCredential] = await tx
          .insert(tables.integrationCredentials)
          .values({
            organizationId: lockedConnection.organizationId,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
            ciphertext: encryptedAccessToken.ciphertext,
            nonce: encryptedAccessToken.nonce,
            organizationCredentialKeyVersion: latestOrganizationCredentialKey.version,
            intendedFamilyId: input.target.familyId,
            ...(exchangedAccessToken.credentialMetadata === undefined
              ? {}
              : { metadata: exchangedAccessToken.credentialMetadata }),
            ...(exchangedAccessToken.accessTokenExpiresAt
              ? { expiresAt: exchangedAccessToken.accessTokenExpiresAt }
              : {}),
          })
          .returning({
            id: tables.integrationCredentials.id,
          });

        if (createdAccessTokenCredential === undefined) {
          throw new Error("Failed to create OAuth2 client-credentials access token credential.");
        }

        await tx
          .insert(tables.integrationConnectionCredentials)
          .values({
            connectionId: lockedConnection.id,
            credentialId: createdAccessTokenCredential.id,
            slotKey: input.accessTokenSlotKey,
          })
          .onConflictDoUpdate({
            target: [
              tables.integrationConnectionCredentials.connectionId,
              tables.integrationConnectionCredentials.slotKey,
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
            .update(tables.integrationCredentials)
            .set({
              revokedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(tables.integrationCredentials.id, accessCredential.credentialId),
                isNull(tables.integrationCredentials.revokedAt),
              ),
            );
        }
      } finally {
        latestUnwrappedOrganizationCredentialKey.fill(0);
      }

      return {
        credential: createValueCredential({
          value: exchangedAccessToken.accessToken,
          ...(exchangedAccessToken.accessTokenExpiresAt
            ? { expiresAt: exchangedAccessToken.accessTokenExpiresAt }
            : {}),
        }),
      };
    },
  );

  return resolution.credential;
}

async function resolvePersistedCredential(
  input: ResolvePersistedCredentialInput,
): Promise<ResolvedIntegrationCredential> {
  const slotKey = resolvePersistedSlotKeyOrThrow(input.slotKey);

  const linkedCredential = await input.db.query.integrationConnectionCredentials.findFirst({
    columns: {
      credentialId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.connectionId, input.connectionId), eq(table.slotKey, slotKey)),
  });

  if (linkedCredential === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No linked integration credential was found for this slot.",
    );
  }

  const persistedSecretType = parsePersistedSecretType(input.secretType);
  if (persistedSecretType === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No active integration credential was found for this secret type.",
    );
  }

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

  if (credential === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No active integration credential was found for this secret type.",
    );
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

    return createValueCredential({
      value,
      ...(credential.expiresAt === null
        ? {}
        : { expiresAt: normalizeCredentialExpiryOrThrow(credential.expiresAt) }),
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

export async function resolveIntegrationCredential(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
    integrationRegistry: AppContext["var"]["integrationRegistry"];
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: ResolveIntegrationCredentialInput,
): Promise<ResolvedIntegrationCredential> {
  return await ResolveIntegrationCredentialTracer.startActiveSpan(
    "control_plane.integration_credentials.resolve",
    async (span: Span) => {
      span.setAttributes(
        createResolveCredentialTelemetryAttributes({
          connectionId: input.connectionId,
          ...(input.bindingId === undefined ? {} : { bindingId: input.bindingId }),
          secretType: input.secretType,
          ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
          ...(input.resolverKey === undefined ? {} : { resolverKey: input.resolverKey }),
          hasBindingContext: input.bindingId !== undefined,
        }),
      );

      try {
        const { db, integrationRegistry, integrationsConfig } = ctx;
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
          const bindingId = input.bindingId;
          const binding = await db.query.sandboxProfileVersionIntegrationBindings.findFirst({
            columns: {
              id: true,
              kind: true,
              connectionId: true,
              config: true,
            },
            where: (table, { eq }) => eq(table.id, bindingId),
          });

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

        const initialConnectionResolverContext = resolveResolverContextConnection({
          id: connection.id,
          status: connection.status,
          externalSubjectId: connection.externalSubjectId,
          config: connection.config,
        });
        const connectionMethodId = resolveConnectionMethodId(
          initialConnectionResolverContext.config,
        );
        const connectionMethod = definition.connectionMethods.find(
          (method) => method.id === connectionMethodId,
        );
        span.setAttributes(
          createResolveCredentialTelemetryAttributes({
            connectionId: connection.id,
            ...(bindingResolverContext === undefined
              ? {}
              : { bindingId: bindingResolverContext.id }),
            targetKey: connection.targetKey,
            familyId: target.familyId,
            variantId: target.variantId,
            ...(connectionMethodId === undefined ? {} : { connectionMethod: connectionMethodId }),
            secretType: input.secretType,
            ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
            ...(input.resolverKey === undefined ? {} : { resolverKey: input.resolverKey }),
            hasBindingContext: bindingResolverContext !== undefined,
          }),
        );

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
          const hydratedConnection = await resolveHydratedResolverContextConnection({
            db,
            integrationsConfig,
            organizationId: connection.organizationId,
            connection: {
              id: connection.id,
              status: connection.status,
              externalSubjectId: connection.externalSubjectId,
              config: connection.config,
            },
            ...(connectionMethod?.kind === "form" ? { connectionMethod } : {}),
          });
          span.setAttribute(
            "mistle.integration.resolve.has_hydrated_connection_secrets",
            hydratedConnection.hasHydratedConnectionSecrets,
          );

          const resolvedCredential = await customResolver.resolve({
            organizationId: connection.organizationId,
            targetKey: connection.targetKey,
            connectionId: connection.id,
            target: targetResolverContext,
            connection: hydratedConnection.connection,
            ...(bindingResolverContext === undefined ? {} : { binding: bindingResolverContext }),
            secretType: input.secretType,
            ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
          });
          span.setAttribute("mistle.integration.credential.result_kind", resolvedCredential.kind);

          return resolvedCredential;
        }

        if (
          definition.oauth2AuthorizationCode !== undefined &&
          connectionMethod !== undefined &&
          (connectionMethod.kind === "redirect" ||
            connectionMethod.kind === "device-authorization") &&
          (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN ||
            input.secretType === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN)
        ) {
          const targetResolverContext = resolveResolverContextTarget({
            target,
            definition,
            integrationsConfig,
          });
          const oauth2AuthorizationCodeSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
            familyId: target.familyId,
            variantId: target.variantId,
          });

          const resolvedCredential = await resolveOAuth2AuthorizationCodeManagedCredential({
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
            oauth2AuthorizationCode: definition.oauth2AuthorizationCode,
            secretType: input.secretType,
            ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
            accessTokenSlotKey: oauth2AuthorizationCodeSlotKeys.accessToken,
            refreshTokenSlotKey: oauth2AuthorizationCodeSlotKeys.refreshToken,
            clientSecretSlotKey: oauth2AuthorizationCodeSlotKeys.clientSecret,
          });
          span.setAttribute("mistle.integration.credential.result_kind", resolvedCredential.kind);

          return resolvedCredential;
        }

        const oauth2ClientSecretField =
          connectionMethod?.kind === "form"
            ? connectionMethod.secretFields.find(
                (secretField) =>
                  secretField.secretType === IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
              )
            : undefined;
        if (
          connectionMethod?.kind === "form" &&
          oauth2ClientSecretField !== undefined &&
          definition.oauth2ClientCredentials !== undefined &&
          input.secretType === IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN
        ) {
          const targetResolverContext = resolveResolverContextTarget({
            target,
            definition,
            integrationsConfig,
          });

          const resolvedCredential = await resolveOAuth2ClientCredentialsManagedCredential({
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
            oauth2ClientCredentials: definition.oauth2ClientCredentials,
            secretType: input.secretType,
            ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
            accessTokenSlotKey: resolvePersistedSlotKeyOrThrow(input.slotKey),
            clientSecretSlotKey: oauth2ClientSecretField.slotKey,
          });
          span.setAttribute("mistle.integration.credential.result_kind", resolvedCredential.kind);

          return resolvedCredential;
        }

        const defaultResolver = definition.credentialResolvers?.default;
        if (defaultResolver !== undefined) {
          const targetResolverContext = resolveResolverContextTarget({
            target,
            definition,
            integrationsConfig,
          });
          const hydratedConnection = await resolveHydratedResolverContextConnection({
            db,
            integrationsConfig,
            organizationId: connection.organizationId,
            connection: {
              id: connection.id,
              status: connection.status,
              externalSubjectId: connection.externalSubjectId,
              config: connection.config,
            },
            ...(connectionMethod?.kind === "form" ? { connectionMethod } : {}),
          });
          span.setAttribute(
            "mistle.integration.resolve.has_hydrated_connection_secrets",
            hydratedConnection.hasHydratedConnectionSecrets,
          );

          const resolvedCredential = await defaultResolver.resolve({
            organizationId: connection.organizationId,
            targetKey: connection.targetKey,
            connectionId: connection.id,
            target: targetResolverContext,
            connection: hydratedConnection.connection,
            ...(bindingResolverContext === undefined ? {} : { binding: bindingResolverContext }),
            secretType: input.secretType,
            ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
          });
          span.setAttribute("mistle.integration.credential.result_kind", resolvedCredential.kind);

          return resolvedCredential;
        }

        const resolvedCredential = await resolvePersistedCredential({
          db,
          integrationsConfig,
          organizationId: connection.organizationId,
          connectionId: connection.id,
          secretType: input.secretType,
          ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
        });
        span.setAttribute("mistle.integration.credential.result_kind", resolvedCredential.kind);

        return resolvedCredential;
      } catch (error) {
        logger.error(
          {
            err: error,
            connectionId: input.connectionId,
            ...(input.bindingId === undefined ? {} : { bindingId: input.bindingId }),
            secretType: input.secretType,
            ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
            ...(input.resolverKey === undefined ? {} : { resolverKey: input.resolverKey }),
          },
          "Failed to resolve integration credential",
        );
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "integration credential resolution failed",
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
