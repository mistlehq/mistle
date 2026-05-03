import {
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type {
  IntegrationCredentialResolverResult,
  IntegrationRegistry,
  RefreshedIdentityLinkingCredential,
} from "@mistle/integrations-core";
import { and, eq, inArray, ne, not, sql } from "drizzle-orm";

import { resolveIdentityLinkingRuntimeContextOrThrow } from "../../../identity-linking/services/identity-linking-definition.js";
import { resolveIdentityLinkProviderContextOrThrow } from "../../../identity-linking/services/resolve-identity-link-provider-context.js";
import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../../lib/crypto.js";
import {
  createCredentialSecretResolver,
  resolvePrincipalCredentialSecretKindOrThrow,
  type LoadedCredentialSecret,
} from "./credential-secret-resolution.js";
import { InternalIdentityLinkingError, InternalIdentityLinkingErrorCodes } from "./errors.js";

type ResolvePrincipalCredentialInput = {
  organizationId: string;
  actingUserId: string;
  providerFamily: string;
  credentialKind?: string;
};

type LoadedCredential = {
  id: string;
  principalId: string;
  organizationId: string;
  providerFamily: string;
  credentialKind: string;
  status: string;
  scopes: string[] | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
};

class CredentialResolutionStateError extends Error {
  readonly code:
    | typeof InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED
    | typeof InternalIdentityLinkingErrorCodes.CREDENTIAL_REFRESH_FAILED;
  readonly credentialId: string;
  readonly status: 400;

  constructor(input: {
    code:
      | typeof InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED
      | typeof InternalIdentityLinkingErrorCodes.CREDENTIAL_REFRESH_FAILED;
    credentialId: string;
    message: string;
  }) {
    super(input.message);
    this.name = "CredentialResolutionStateError";
    this.code = input.code;
    this.credentialId = input.credentialId;
    this.status = 400;
  }
}

function isExpired(timestamp: string | null | undefined): boolean {
  if (timestamp === null || timestamp === undefined) {
    return false;
  }

  const parsedTimestamp = Date.parse(timestamp);
  if (Number.isNaN(parsedTimestamp)) {
    throw new Error(`Invalid credential expiry timestamp '${timestamp}'.`);
  }

  return parsedTimestamp <= Date.now();
}

function resolveIdentityLinkingErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const { code } = error;
  return typeof code === "string" ? code : undefined;
}

function chooseCredentialOrThrow(input: {
  providerFamily: string;
  principalId: string;
  credentialKind?: string;
  credentials: LoadedCredential[];
}): LoadedCredential {
  const matchingCredentials =
    input.credentialKind === undefined
      ? input.credentials
      : input.credentials.filter(
          (credential) => credential.credentialKind === input.credentialKind,
        );

  if (matchingCredentials.length === 0) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      input.credentialKind === undefined
        ? `No linked-principal credentials were found for principal '${input.principalId}' and provider '${input.providerFamily}'.`
        : `No linked-principal credential '${input.credentialKind}' was found for principal '${input.principalId}' and provider '${input.providerFamily}'.`,
    );
  }

  if (input.credentialKind === undefined && matchingCredentials.length > 1) {
    throw new InternalIdentityLinkingError(
      InternalIdentityLinkingErrorCodes.AMBIGUOUS_CREDENTIAL_KIND,
      400,
      `Multiple linked-principal credentials are available for principal '${input.principalId}' and provider '${input.providerFamily}'.`,
    );
  }

  const credential = matchingCredentials[0];
  if (credential === undefined) {
    throw new Error("Expected linked-principal credential candidate.");
  }

  return credential;
}

function pickResolvedSecret(input: {
  credential: LoadedCredential;
  secrets: LoadedCredentialSecret[];
}): LoadedCredentialSecret | undefined {
  const activeSecrets = input.secrets.filter((secret) => secret.revokedAt === null);

  const oauth2AccessToken = activeSecrets.find(
    (secret) =>
      secret.secretKind === UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
  );
  if (oauth2AccessToken !== undefined) {
    if (
      isExpired(input.credential.accessTokenExpiresAt) ||
      isExpired(oauth2AccessToken.expiresAt)
    ) {
      return undefined;
    }

    return oauth2AccessToken;
  }

  const providerUserToken = activeSecrets.find(
    (secret) =>
      secret.secretKind === UserExternalPrincipalCredentialSecretKinds.PROVIDER_USER_TOKEN,
  );
  if (providerUserToken !== undefined) {
    if (isExpired(providerUserToken.expiresAt)) {
      return undefined;
    }

    return providerUserToken;
  }

  return undefined;
}

function toIsoTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Expected credential expiry '${value}' to be parseable as a timestamp.`);
  }

  return new Date(timestamp).toISOString();
}

async function markCredentialReauthorizationRequired(input: {
  db: ControlPlaneDatabase;
  credentialId: string;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  await input.db
    .update(tables.userExternalPrincipalCredentials)
    .set({
      status: UserExternalPrincipalCredentialStatuses.REAUTHORIZATION_REQUIRED,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.userExternalPrincipalCredentials.id, input.credentialId));
}

async function resolveCurrentOrganizationCredentialKeyOrThrow(input: {
  tx: ControlPlaneDatabase;
  organizationId: string;
  integrationsConfig: {
    masterEncryptionKeys: Record<string, string>;
  };
}): Promise<{
  version: number;
  keyMaterial: Buffer;
}> {
  const organizationCredentialKey = await input.tx.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });

  return {
    version: organizationCredentialKey.version,
    keyMaterial: unwrapOrganizationCredentialKey({
      wrappedCiphertext: organizationCredentialKey.ciphertext,
      masterEncryptionKeyMaterial,
    }),
  };
}

async function upsertRefreshedCredential(input: {
  tx: ControlPlaneDatabase;
  credentialId: string;
  organizationId: string;
  refreshedCredential: RefreshedIdentityLinkingCredential;
  integrationsConfig: {
    masterEncryptionKeys: Record<string, string>;
  };
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.tx);

  const currentOrganizationCredentialKey = await resolveCurrentOrganizationCredentialKeyOrThrow({
    tx: input.tx,
    organizationId: input.organizationId,
    integrationsConfig: input.integrationsConfig,
  });

  try {
    await input.tx
      .update(tables.userExternalPrincipalCredentials)
      .set({
        credentialKind: input.refreshedCredential.credentialKind,
        status: UserExternalPrincipalCredentialStatuses.ACTIVE,
        scopes: input.refreshedCredential.scopes ?? null,
        accessTokenExpiresAt: input.refreshedCredential.accessTokenExpiresAt ?? null,
        refreshTokenExpiresAt: input.refreshedCredential.refreshTokenExpiresAt ?? null,
        lastValidatedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.userExternalPrincipalCredentials.id, input.credentialId));

    const refreshedSecretKinds = input.refreshedCredential.secrets.map((secret) =>
      resolvePrincipalCredentialSecretKindOrThrow(secret.secretKind),
    );

    if (refreshedSecretKinds.length > 0) {
      await input.tx
        .update(tables.userExternalPrincipalCredentialSecrets)
        .set({
          revokedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(tables.userExternalPrincipalCredentialSecrets.credentialId, input.credentialId),
            not(
              inArray(
                tables.userExternalPrincipalCredentialSecrets.secretKind,
                refreshedSecretKinds,
              ),
            ),
            sql`${tables.userExternalPrincipalCredentialSecrets.revokedAt} is null`,
          ),
        );
    }

    for (const secret of input.refreshedCredential.secrets) {
      const encryptedSecret = encryptCredentialUtf8({
        plaintext: secret.plaintext,
        organizationCredentialKey: currentOrganizationCredentialKey.keyMaterial,
      });

      await input.tx
        .insert(tables.userExternalPrincipalCredentialSecrets)
        .values({
          organizationId: input.organizationId,
          credentialId: input.credentialId,
          secretKind: resolvePrincipalCredentialSecretKindOrThrow(secret.secretKind),
          nonce: encryptedSecret.nonce,
          ciphertext: encryptedSecret.ciphertext,
          organizationCredentialKeyVersion: currentOrganizationCredentialKey.version,
          metadata: secret.metadata ?? null,
          expiresAt: secret.expiresAt ?? null,
          revokedAt: null,
          updatedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [
            tables.userExternalPrincipalCredentialSecrets.credentialId,
            tables.userExternalPrincipalCredentialSecrets.secretKind,
          ],
          set: {
            nonce: encryptedSecret.nonce,
            ciphertext: encryptedSecret.ciphertext,
            organizationCredentialKeyVersion: currentOrganizationCredentialKey.version,
            metadata: secret.metadata ?? null,
            expiresAt: secret.expiresAt ?? null,
            revokedAt: null,
            updatedAt: sql`now()`,
          },
        });
    }
  } finally {
    currentOrganizationCredentialKey.keyMaterial.fill(0);
  }
}

async function resolveStaticCredentialValue(input: {
  credential: LoadedCredential;
  secrets: LoadedCredentialSecret[];
  resolveCredentialSecret: (secretKind: string) => Promise<string>;
}): Promise<IntegrationCredentialResolverResult | undefined> {
  const resolvedSecret = pickResolvedSecret({
    credential: input.credential,
    secrets: input.secrets,
  });
  if (resolvedSecret === undefined) {
    return undefined;
  }

  const value = await input.resolveCredentialSecret(resolvedSecret.secretKind);
  const expiresAt =
    resolvedSecret.secretKind === UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN
      ? (input.credential.accessTokenExpiresAt ?? undefined)
      : (resolvedSecret.expiresAt ?? undefined);

  return {
    kind: "value",
    value,
    ...(expiresAt === undefined ? {} : { expiresAt: toIsoTimestamp(expiresAt) }),
  };
}

export async function resolvePrincipalCredential(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: ResolvePrincipalCredentialInput,
): Promise<IntegrationCredentialResolverResult> {
  const providerContext = await resolveIdentityLinkProviderContextOrThrow(ctx, {
    organizationId: input.organizationId,
    providerFamily: input.providerFamily,
  });
  const identityLinkingRuntime = await resolveIdentityLinkingRuntimeContextOrThrow({
    db: ctx.db,
    integrationRegistry: ctx.integrationRegistry,
    integrationsConfig: ctx.integrationsConfig,
    organizationId: input.organizationId,
    integrationTarget: providerContext.integrationTarget,
    integrationConnection: providerContext.integrationConnection,
  });

  try {
    return await ctx.db.transaction(async (tx) => {
      const tables = getControlPlaneDatabaseSchema(tx);

      const [lockedPrincipal] = await tx
        .select({
          id: tables.userExternalPrincipals.id,
        })
        .from(tables.userExternalPrincipals)
        .where(
          and(
            eq(tables.userExternalPrincipals.organizationId, input.organizationId),
            eq(tables.userExternalPrincipals.userId, input.actingUserId),
            eq(tables.userExternalPrincipals.providerFamily, input.providerFamily),
            eq(
              tables.userExternalPrincipals.organizationProviderConfigId,
              providerContext.organizationProviderConfig.id,
            ),
            eq(tables.userExternalPrincipals.status, UserExternalPrincipalStatuses.ACTIVE),
          ),
        )
        .limit(1)
        .for("update");

      if (lockedPrincipal === undefined) {
        throw new InternalIdentityLinkingError(
          InternalIdentityLinkingErrorCodes.PRINCIPAL_NOT_FOUND,
          404,
          `No active linked principal was found for user '${input.actingUserId}' and provider '${input.providerFamily}'.`,
        );
      }

      const credentials = await tx
        .select({
          id: tables.userExternalPrincipalCredentials.id,
          principalId: tables.userExternalPrincipalCredentials.principalId,
          organizationId: tables.userExternalPrincipalCredentials.organizationId,
          providerFamily: tables.userExternalPrincipalCredentials.providerFamily,
          credentialKind: tables.userExternalPrincipalCredentials.credentialKind,
          status: tables.userExternalPrincipalCredentials.status,
          scopes: tables.userExternalPrincipalCredentials.scopes,
          accessTokenExpiresAt: tables.userExternalPrincipalCredentials.accessTokenExpiresAt,
          refreshTokenExpiresAt: tables.userExternalPrincipalCredentials.refreshTokenExpiresAt,
        })
        .from(tables.userExternalPrincipalCredentials)
        .where(
          and(
            eq(tables.userExternalPrincipalCredentials.organizationId, input.organizationId),
            eq(tables.userExternalPrincipalCredentials.principalId, lockedPrincipal.id),
            eq(tables.userExternalPrincipalCredentials.providerFamily, input.providerFamily),
            ne(
              tables.userExternalPrincipalCredentials.status,
              UserExternalPrincipalCredentialStatuses.REVOKED,
            ),
            ...(input.credentialKind === undefined
              ? []
              : [eq(tables.userExternalPrincipalCredentials.credentialKind, input.credentialKind)]),
          ),
        )
        .for("update");

      const credential = chooseCredentialOrThrow({
        providerFamily: input.providerFamily,
        principalId: lockedPrincipal.id,
        ...(input.credentialKind === undefined ? {} : { credentialKind: input.credentialKind }),
        credentials,
      });

      if (credential.status === UserExternalPrincipalCredentialStatuses.REAUTHORIZATION_REQUIRED) {
        throw new InternalIdentityLinkingError(
          InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED,
          400,
          `Linked-principal credential '${credential.credentialKind}' requires reauthorization.`,
        );
      }

      const credentialSecrets = await tx
        .select({
          secretKind: tables.userExternalPrincipalCredentialSecrets.secretKind,
          ciphertext: tables.userExternalPrincipalCredentialSecrets.ciphertext,
          nonce: tables.userExternalPrincipalCredentialSecrets.nonce,
          organizationCredentialKeyVersion:
            tables.userExternalPrincipalCredentialSecrets.organizationCredentialKeyVersion,
          expiresAt: tables.userExternalPrincipalCredentialSecrets.expiresAt,
          revokedAt: tables.userExternalPrincipalCredentialSecrets.revokedAt,
        })
        .from(tables.userExternalPrincipalCredentialSecrets)
        .where(eq(tables.userExternalPrincipalCredentialSecrets.credentialId, credential.id));

      const credentialSecretResolver = await createCredentialSecretResolver({
        tx,
        organizationId: input.organizationId,
        integrationsConfig: ctx.integrationsConfig,
        secrets: credentialSecrets,
      });
      try {
        const resolvedCredential = await resolveStaticCredentialValue({
          credential,
          secrets: credentialSecrets,
          resolveCredentialSecret: credentialSecretResolver.resolve,
        });
        if (
          resolvedCredential !== undefined &&
          credential.status === UserExternalPrincipalCredentialStatuses.ACTIVE
        ) {
          return resolvedCredential;
        }

        const refreshTokenSecret = credentialSecrets.find(
          (secret) =>
            secret.revokedAt === null &&
            secret.secretKind === UserExternalPrincipalCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
        );
        if (
          refreshTokenSecret === undefined ||
          isExpired(credential.refreshTokenExpiresAt) ||
          isExpired(refreshTokenSecret.expiresAt)
        ) {
          throw new CredentialResolutionStateError({
            code: InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED,
            credentialId: credential.id,
            message: `Linked-principal credential '${credential.credentialKind}' cannot be refreshed and requires reauthorization.`,
          });
        }

        if (identityLinkingRuntime.identityLinking.refreshCredential === undefined) {
          throw new CredentialResolutionStateError({
            code: InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED,
            credentialId: credential.id,
            message: `Linked-principal credential '${credential.credentialKind}' requires reauthorization.`,
          });
        }

        let refreshedCredential;
        try {
          refreshedCredential = await identityLinkingRuntime.identityLinking.refreshCredential.call(
            identityLinkingRuntime.identityLinking,
            {
              organizationId: input.organizationId,
              userId: input.actingUserId,
              providerFamily: input.providerFamily,
              target: identityLinkingRuntime.target,
              connection: identityLinkingRuntime.connection,
              credential: {
                credentialKind: credential.credentialKind,
                ...(credential.scopes === null ? {} : { scopes: credential.scopes }),
                ...(credential.accessTokenExpiresAt === null
                  ? {}
                  : { accessTokenExpiresAt: credential.accessTokenExpiresAt }),
                ...(credential.refreshTokenExpiresAt === null
                  ? {}
                  : { refreshTokenExpiresAt: credential.refreshTokenExpiresAt }),
              },
              now: new Date().toISOString(),
              resolveConnectionSecret: identityLinkingRuntime.resolveConnectionSecret,
              resolveCredentialSecret: async ({ secretKind }) =>
                await credentialSecretResolver.resolve(secretKind),
            },
          );
        } catch (error) {
          const errorCode = resolveIdentityLinkingErrorCode(error);
          if (errorCode === "IDENTITY_LINKING_INVALID_PROVIDER_CONFIG") {
            throw new InternalIdentityLinkingError(
              InternalIdentityLinkingErrorCodes.INVALID_PROVIDER_CONFIG_INPUT,
              400,
              error instanceof Error
                ? error.message
                : "Identity-linking provider config is invalid.",
            );
          }

          if (errorCode === "IDENTITY_LINKING_AUTHORIZATION_FAILED") {
            throw new CredentialResolutionStateError({
              code: InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED,
              credentialId: credential.id,
              message:
                error instanceof Error
                  ? error.message
                  : `Linked-principal credential '${credential.credentialKind}' requires reauthorization.`,
            });
          }

          throw error;
        }

        await upsertRefreshedCredential({
          tx,
          credentialId: credential.id,
          organizationId: input.organizationId,
          refreshedCredential,
          integrationsConfig: ctx.integrationsConfig,
        });

        const refreshedSecrets = await tx
          .select({
            secretKind: tables.userExternalPrincipalCredentialSecrets.secretKind,
            ciphertext: tables.userExternalPrincipalCredentialSecrets.ciphertext,
            nonce: tables.userExternalPrincipalCredentialSecrets.nonce,
            organizationCredentialKeyVersion:
              tables.userExternalPrincipalCredentialSecrets.organizationCredentialKeyVersion,
            expiresAt: tables.userExternalPrincipalCredentialSecrets.expiresAt,
            revokedAt: tables.userExternalPrincipalCredentialSecrets.revokedAt,
          })
          .from(tables.userExternalPrincipalCredentialSecrets)
          .where(eq(tables.userExternalPrincipalCredentialSecrets.credentialId, credential.id));

        const refreshedSecretResolver = await createCredentialSecretResolver({
          tx,
          organizationId: input.organizationId,
          integrationsConfig: ctx.integrationsConfig,
          secrets: refreshedSecrets,
        });

        try {
          const resolvedRefreshedCredential = await resolveStaticCredentialValue({
            credential: {
              ...credential,
              credentialKind: refreshedCredential.credentialKind,
              status: UserExternalPrincipalCredentialStatuses.ACTIVE,
              scopes: refreshedCredential.scopes ?? null,
              accessTokenExpiresAt: refreshedCredential.accessTokenExpiresAt ?? null,
              refreshTokenExpiresAt: refreshedCredential.refreshTokenExpiresAt ?? null,
            },
            secrets: refreshedSecrets,
            resolveCredentialSecret: refreshedSecretResolver.resolve,
          });

          if (resolvedRefreshedCredential === undefined) {
            throw new CredentialResolutionStateError({
              code: InternalIdentityLinkingErrorCodes.CREDENTIAL_REFRESH_FAILED,
              credentialId: credential.id,
              message: `Linked-principal credential '${credential.credentialKind}' did not return a usable token after refresh.`,
            });
          }

          return resolvedRefreshedCredential;
        } finally {
          refreshedSecretResolver.cleanup();
        }
      } finally {
        credentialSecretResolver.cleanup();
      }
    });
  } catch (error) {
    if (error instanceof CredentialResolutionStateError) {
      await markCredentialReauthorizationRequired({
        db: ctx.db,
        credentialId: error.credentialId,
      });
      throw new InternalIdentityLinkingError(error.code, error.status, error.message);
    }

    throw error;
  }
}
