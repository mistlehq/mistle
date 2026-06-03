import type { Cache } from "@mistle/cache";
import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import {
  GitHubAppInstallationConnectionConfigSchema,
  GitHubApiKeyConnectionConfigSchema,
  GitHubCredentialSlotKeys,
  GitHubCredentialSecretTypes,
  GitHubFamilyId,
  GitHubTargetConfigSchema,
} from "@mistle/integrations-definitions";
import { GitHubAppInstallationCredentialResolver } from "@mistle/integrations-definitions/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  GitHubProviderFamily,
  GitSshSigningCredentialKind,
  GitSshSigningSecretMetadataSchema,
} from "../../identity-linking/github-signing.js";
import { resolveConnectionSecretOrThrow } from "../../identity-linking/services/resolve-connection-secret.js";
import { SandboxProfilesBadRequestCodes, SandboxProfilesBadRequestError } from "../errors.js";
import { resolveGitCommitSigningPolicy } from "./git-signing-policy.js";

const GitSigningProgram = "/opt/mistle/bin/mistle-ssh-sign";
const GitActorIdentityCacheTtlMs = 60 * 60 * 1000;
const GitHubUserProfilePath = "/user";

const GitHubPrincipalProfileSchema = z
  .object({
    login: z.string().min(1),
    displayName: z.string().min(1).optional(),
    preferredEmail: z.email().optional(),
  })
  .loose();

const GitHubUserProfileSchema = z
  .object({
    id: z.number().int().nonnegative(),
    login: z.string().min(1),
    name: z.string().min(1).nullable().optional(),
    email: z.email().nullable().optional(),
  })
  .loose();

const CachedGitActorIdentitySchema = z
  .object({
    name: z.string().min(1),
    email: z.string().min(1),
  })
  .strict();

type GitActorIdentity = {
  name: string;
  email: string;
};

type GitHubConnectionContext = {
  connectionId: string;
  targetKey: string;
  connectionConfig: Record<string, unknown> | null;
  targetConfig: Record<string, unknown> | null;
  targetFamilyId: string;
  targetVariantId: string;
  targetEnabled: boolean;
};

type GitHubSigningProviderConfig = {
  id: string;
  integrationConnectionId: string;
  policy: unknown;
};

type GitActorIdentityIntegrationsConfig = {
  masterEncryptionKeys: Record<string, string>;
};

export type SandboxActingUser = {
  userId: string;
};

export type SandboxGitIdentity = GitActorIdentity & {
  signing?: {
    format: "ssh";
    program: string;
    keyRef: string;
    organizationId: string;
    providerFamily: string;
    integrationConnectionId: string;
    actingUserId: string;
  };
};

function createSigningRequiredError(input: {
  organizationId: string;
  userId: string;
  reason: string;
}): SandboxProfilesBadRequestError {
  return new SandboxProfilesBadRequestError(
    SandboxProfilesBadRequestCodes.GIT_SIGNING_CONFIGURATION_REQUIRED,
    `Git commit signing is required for user '${input.userId}' in organization '${input.organizationId}', but ${input.reason}.`,
  );
}

function buildUrlWithPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createGitHubNoreplyEmail(input: { id: number; login: string }): string {
  return `${String(input.id)}+${input.login}@users.noreply.github.com`;
}

function normalizeGitHubUserName(input: { login: string; name?: string | null }): string {
  const displayName = input.name?.trim();
  return displayName === undefined || displayName.length === 0 ? input.login : displayName;
}

function createGitHubActorIdentityCacheKey(
  input:
    | {
        kind: "api-key";
        organizationId: string;
        integrationConnectionId: string;
        credentialId: string;
      }
    | {
        kind: "app-installation";
        organizationId: string;
        integrationConnectionId: string;
        installationId: string;
        appSlug: string;
      },
): string {
  if (input.kind === "api-key") {
    return [
      "sandbox-git-actor-identity",
      "v1",
      "github-api-key",
      input.organizationId,
      input.integrationConnectionId,
      input.credentialId,
    ].join(":");
  }

  return [
    "sandbox-git-actor-identity",
    "v1",
    "github-app",
    input.organizationId,
    input.integrationConnectionId,
    input.installationId,
    input.appSlug,
  ].join(":");
}

async function resolveCachedGitActorIdentity(
  cache: Cache,
  input: {
    key: string;
    resolve: () => Promise<GitActorIdentity>;
  },
): Promise<GitActorIdentity> {
  const cachedValue = await cache.get(input.key);
  if (cachedValue !== null) {
    const parsedCachedValue = CachedGitActorIdentitySchema.safeParse(JSON.parse(cachedValue));
    if (!parsedCachedValue.success) {
      throw new Error(`Cached Git actor identity '${input.key}' is invalid.`);
    }

    return parsedCachedValue.data;
  }

  const resolvedIdentity = await input.resolve();
  await cache.set(input.key, JSON.stringify(resolvedIdentity), {
    ttlMs: GitActorIdentityCacheTtlMs,
  });
  return resolvedIdentity;
}

async function fetchGitHubJson(input: {
  apiBaseUrl: string;
  path: string;
  token?: string;
  errorLabel: string;
}): Promise<unknown> {
  const response = await fetch(buildUrlWithPath(input.apiBaseUrl, input.path), {
    headers: {
      accept: "application/vnd.github+json",
      ...(input.token === undefined ? {} : { authorization: `Bearer ${input.token}` }),
    },
  });

  if (!response.ok) {
    throw new Error(
      `${input.errorLabel} failed (${String(response.status)} ${response.statusText}).`,
    );
  }

  return await response.json();
}

async function resolveGitHubUserProfile(input: {
  apiBaseUrl: string;
  token: string;
}): Promise<z.output<typeof GitHubUserProfileSchema>> {
  const profile = await fetchGitHubJson({
    apiBaseUrl: input.apiBaseUrl,
    path: GitHubUserProfilePath,
    token: input.token,
    errorLabel: "GitHub user profile request",
  });

  return GitHubUserProfileSchema.parse(profile);
}

async function resolveGitHubApiKeyOwnerIdentity(input: {
  apiBaseUrl: string;
  token: string;
}): Promise<GitActorIdentity> {
  const profile = await resolveGitHubUserProfile(input);
  const email = profile.email ?? createGitHubNoreplyEmail(profile);

  return {
    name: normalizeGitHubUserName({
      login: profile.login,
      ...(profile.name === undefined ? {} : { name: profile.name }),
    }),
    email,
  };
}

async function resolveGitHubAppBotIdentity(input: {
  apiBaseUrl: string;
  appSlug: string;
  token: string;
}): Promise<GitActorIdentity> {
  const botLogin = `${input.appSlug}[bot]`;
  const profile = GitHubUserProfileSchema.parse(
    await fetchGitHubJson({
      apiBaseUrl: input.apiBaseUrl,
      path: `/users/${encodeURIComponent(botLogin)}`,
      token: input.token,
      errorLabel: "GitHub App bot profile request",
    }),
  );

  return {
    name: profile.login,
    email: createGitHubNoreplyEmail(profile),
  };
}

async function resolveGitHubConnectionContext(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    integrationConnectionId: string;
  },
): Promise<GitHubConnectionContext> {
  const tables = getControlPlaneDatabaseSchema(db);
  const [row] = await db
    .select({
      connectionId: tables.integrationConnections.id,
      connectionConfig: tables.integrationConnections.config,
      targetKey: tables.integrationConnections.targetKey,
      targetConfig: tables.integrationTargets.config,
      targetFamilyId: tables.integrationTargets.familyId,
      targetVariantId: tables.integrationTargets.variantId,
      targetEnabled: tables.integrationTargets.enabled,
    })
    .from(tables.integrationConnections)
    .innerJoin(
      tables.integrationTargets,
      eq(tables.integrationTargets.targetKey, tables.integrationConnections.targetKey),
    )
    .where(
      and(
        eq(tables.integrationConnections.organizationId, input.organizationId),
        eq(tables.integrationConnections.id, input.integrationConnectionId),
        eq(tables.integrationConnections.status, IntegrationConnectionStatuses.ACTIVE),
      ),
    );

  if (row === undefined) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      `Git connection '${input.integrationConnectionId}' is not active or does not exist.`,
    );
  }

  if (row.targetFamilyId !== GitHubFamilyId) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      `Git connection '${input.integrationConnectionId}' uses unsupported provider family '${row.targetFamilyId}'.`,
    );
  }

  return {
    connectionId: row.connectionId,
    targetKey: row.targetKey,
    connectionConfig: row.connectionConfig,
    targetConfig: row.targetConfig,
    targetFamilyId: row.targetFamilyId,
    targetVariantId: row.targetVariantId,
    targetEnabled: row.targetEnabled,
  };
}

async function resolveCredentialIdForSlot(
  db: ControlPlaneDatabase,
  input: {
    connectionId: string;
    slotKey: string;
  },
): Promise<string> {
  const linkedCredential = await db.query.integrationConnectionCredentials.findFirst({
    columns: {
      credentialId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.connectionId, input.connectionId), eq(table.slotKey, input.slotKey)),
  });

  if (linkedCredential === undefined) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      `Git connection '${input.connectionId}' is missing credential slot '${input.slotKey}'.`,
    );
  }

  return linkedCredential.credentialId;
}

function resolveGitHubApiKeySlotKey(input: { targetVariantId: string }): string {
  return input.targetVariantId === "github-cloud"
    ? GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY
    : GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_API_KEY;
}

function resolveGitHubAppPrivateKeySlotKey(input: { targetVariantId: string }): string {
  return input.targetVariantId === "github-cloud"
    ? GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_PRIVATE_KEY_PEM
    : GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_APP_PRIVATE_KEY_PEM;
}

async function resolveGitHubAppInstallationToken(
  db: ControlPlaneDatabase,
  input: {
    integrationsConfig: GitActorIdentityIntegrationsConfig;
    organizationId: string;
    targetConfig: z.output<typeof GitHubTargetConfigSchema>;
    githubConnection: GitHubConnectionContext;
  },
): Promise<string> {
  const appPrivateKeyPem = await resolveConnectionSecretOrThrow({
    db,
    organizationId: input.organizationId,
    connectionId: input.githubConnection.connectionId,
    slotKey: resolveGitHubAppPrivateKeySlotKey({
      targetVariantId: input.githubConnection.targetVariantId,
    }),
    secretKind: IntegrationCredentialSecretKinds.API_KEY,
    integrationsConfig: input.integrationsConfig,
  });
  const resolvedCredential = await GitHubAppInstallationCredentialResolver.resolve({
    organizationId: input.organizationId,
    targetKey: input.githubConnection.targetKey,
    connectionId: input.githubConnection.connectionId,
    target: {
      familyId: input.githubConnection.targetFamilyId,
      variantId: input.githubConnection.targetVariantId,
      enabled: input.githubConnection.targetEnabled,
      config: input.targetConfig,
      secrets: {},
    },
    connection: {
      id: input.githubConnection.connectionId,
      status: IntegrationConnectionStatuses.ACTIVE,
      config: input.githubConnection.connectionConfig ?? {},
      secrets: {
        appPrivateKeyPem,
      },
    },
    secretType: GitHubCredentialSecretTypes.GITHUB_APP_INSTALLATION_TOKEN,
  });

  if (resolvedCredential.kind !== "value") {
    throw new Error("GitHub App installation actor resolver expected a value credential.");
  }

  return resolvedCredential.value;
}

async function resolveGitHubConnectionActorIdentity(
  db: ControlPlaneDatabase,
  input: {
    cache: Cache;
    integrationsConfig: GitActorIdentityIntegrationsConfig;
    organizationId: string;
    githubConnection: GitHubConnectionContext;
  },
): Promise<GitActorIdentity> {
  const targetConfig = GitHubTargetConfigSchema.parse(input.githubConnection.targetConfig);
  const appConnectionConfig = GitHubAppInstallationConnectionConfigSchema.safeParse(
    input.githubConnection.connectionConfig,
  );
  if (appConnectionConfig.success) {
    const installationId = appConnectionConfig.data.installation_id;
    if (installationId === undefined) {
      throw new SandboxProfilesBadRequestError(
        SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
        `GitHub App connection '${input.githubConnection.connectionId}' is missing installation_id.`,
      );
    }

    return await resolveCachedGitActorIdentity(input.cache, {
      key: createGitHubActorIdentityCacheKey({
        kind: "app-installation",
        organizationId: input.organizationId,
        integrationConnectionId: input.githubConnection.connectionId,
        installationId,
        appSlug: appConnectionConfig.data.app_slug,
      }),
      resolve: async () => {
        const token = await resolveGitHubAppInstallationToken(db, {
          integrationsConfig: input.integrationsConfig,
          organizationId: input.organizationId,
          targetConfig,
          githubConnection: input.githubConnection,
        });

        return await resolveGitHubAppBotIdentity({
          apiBaseUrl: targetConfig.apiBaseUrl,
          appSlug: appConnectionConfig.data.app_slug,
          token,
        });
      },
    });
  }

  const apiKeyConnectionConfig = GitHubApiKeyConnectionConfigSchema.safeParse(
    input.githubConnection.connectionConfig,
  );
  if (!apiKeyConnectionConfig.success) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      `GitHub connection '${input.githubConnection.connectionId}' has invalid connection config.`,
    );
  }

  const slotKey = resolveGitHubApiKeySlotKey({
    targetVariantId: input.githubConnection.targetVariantId,
  });
  const credentialId = await resolveCredentialIdForSlot(db, {
    connectionId: input.githubConnection.connectionId,
    slotKey,
  });

  return await resolveCachedGitActorIdentity(input.cache, {
    key: createGitHubActorIdentityCacheKey({
      kind: "api-key",
      organizationId: input.organizationId,
      integrationConnectionId: input.githubConnection.connectionId,
      credentialId,
    }),
    resolve: async () => {
      const token = await resolveConnectionSecretOrThrow({
        db,
        organizationId: input.organizationId,
        connectionId: input.githubConnection.connectionId,
        slotKey,
        secretKind: IntegrationCredentialSecretKinds.API_KEY,
        integrationsConfig: input.integrationsConfig,
      });

      return await resolveGitHubApiKeyOwnerIdentity({
        apiBaseUrl: targetConfig.apiBaseUrl,
        token,
      });
    },
  });
}

async function resolveLinkedUserGitHubActorIdentity(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    actingUser?: SandboxActingUser;
    githubProviderConfig: GitHubSigningProviderConfig | null;
    gitCommitSigningMode: "disabled" | "allowed" | "required";
  },
): Promise<{ principalId: string; identity: GitActorIdentity } | null> {
  const actingUser = input.actingUser;
  const githubProviderConfig = input.githubProviderConfig;
  if (actingUser === undefined || githubProviderConfig === null) {
    return null;
  }

  const githubPrincipal = await db.query.userExternalPrincipals.findFirst({
    columns: {
      id: true,
      profile: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.userId, actingUser.userId),
        eq(table.providerFamily, GitHubProviderFamily),
        eq(table.organizationProviderConfigId, githubProviderConfig.id),
        eq(table.status, UserExternalPrincipalStatuses.ACTIVE),
      ),
  });

  if (githubPrincipal === undefined) {
    if (input.gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "no active GitHub linked principal is available",
      });
    }

    return null;
  }

  if (githubPrincipal.profile === null || githubPrincipal.profile === undefined) {
    if (input.gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "the GitHub principal profile is missing",
      });
    }

    return null;
  }

  const parsedProfile = GitHubPrincipalProfileSchema.safeParse(githubPrincipal.profile);
  if (!parsedProfile.success) {
    if (input.gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "the GitHub principal profile is invalid",
      });
    }

    return null;
  }

  const email = parsedProfile.data.preferredEmail?.trim();
  if (email === undefined || email.length === 0) {
    if (input.gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "the GitHub principal does not expose a usable preferred email",
      });
    }

    return null;
  }

  const displayName = parsedProfile.data.displayName?.trim();
  const name =
    displayName === undefined || displayName.length === 0 ? parsedProfile.data.login : displayName;

  return {
    principalId: githubPrincipal.id,
    identity: {
      name,
      email,
    },
  };
}

export async function resolveActingUserGitIdentity(
  db: ControlPlaneDatabase,
  input: {
    cache: Cache;
    integrationsConfig: GitActorIdentityIntegrationsConfig;
    organizationId: string;
    actingUser?: SandboxActingUser;
    gitIntegrationConnectionId?: string | null;
    gitCommitSigningIntegrationConnectionId?: string | null;
  },
): Promise<SandboxGitIdentity | undefined> {
  if (input.gitIntegrationConnectionId === undefined || input.gitIntegrationConnectionId === null) {
    return undefined;
  }

  const githubConnection = await resolveGitHubConnectionContext(db, {
    organizationId: input.organizationId,
    integrationConnectionId: input.gitIntegrationConnectionId,
  });
  const [githubActorProviderConfig, githubSigningProviderConfig] = await Promise.all([
    resolveGitHubIdentityLinkProviderConfig(db, {
      organizationId: input.organizationId,
      integrationConnectionId: input.gitIntegrationConnectionId,
    }),
    resolveGitHubSigningProviderConfig(db, {
      organizationId: input.organizationId,
      integrationConnectionId: input.gitCommitSigningIntegrationConnectionId ?? null,
    }),
  ]);
  if (
    githubSigningProviderConfig !== null &&
    githubSigningProviderConfig.integrationConnectionId !== input.gitIntegrationConnectionId
  ) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      "Selected GitHub commit-signing connection does not match the profile Git connection.",
    );
  }

  const gitCommitSigningPolicy =
    githubSigningProviderConfig === null
      ? resolveGitCommitSigningPolicy({
          policy: null,
          gitCommitSigningIntegrationConnectionId: null,
        })
      : resolveGitCommitSigningPolicy({
          policy: githubSigningProviderConfig.policy ?? null,
          gitCommitSigningIntegrationConnectionId:
            githubSigningProviderConfig.integrationConnectionId,
        });
  const gitCommitSigningMode = gitCommitSigningPolicy.mode;
  const linkedUserActor = await resolveLinkedUserGitHubActorIdentity(db, {
    organizationId: input.organizationId,
    githubProviderConfig: githubActorProviderConfig,
    gitCommitSigningMode,
    ...(input.actingUser === undefined ? {} : { actingUser: input.actingUser }),
  });
  const actorIdentity =
    linkedUserActor?.identity ??
    (await resolveGitHubConnectionActorIdentity(db, {
      cache: input.cache,
      integrationsConfig: input.integrationsConfig,
      organizationId: input.organizationId,
      githubConnection,
    }));

  if (gitCommitSigningMode === "disabled") {
    return actorIdentity;
  }

  if (input.actingUser === undefined) {
    if (gitCommitSigningMode === "required") {
      throw new SandboxProfilesBadRequestError(
        SandboxProfilesBadRequestCodes.GIT_SIGNING_CONFIGURATION_REQUIRED,
        `Git commit signing is required in organization '${input.organizationId}', but no acting user is available.`,
      );
    }

    return actorIdentity;
  }

  if (githubSigningProviderConfig === null || linkedUserActor === null) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: input.actingUser.userId,
        reason: "no active GitHub linked principal is available",
      });
    }

    return actorIdentity;
  }

  if (gitCommitSigningPolicy.format !== "ssh") {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.UNSUPPORTED_GIT_SIGNING_FORMAT,
      `Git commit signing format '${gitCommitSigningPolicy.format}' is not supported yet.`,
    );
  }

  return await attachGitSshSigningConfig(db, {
    organizationId: input.organizationId,
    userId: input.actingUser.userId,
    githubProviderConfig: githubSigningProviderConfig,
    gitCommitSigningMode,
    githubPrincipalId: linkedUserActor.principalId,
    actorIdentity,
  });
}

async function attachGitSshSigningConfig(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    userId: string;
    githubProviderConfig: GitHubSigningProviderConfig;
    gitCommitSigningMode: "allowed" | "required";
    githubPrincipalId: string;
    actorIdentity: GitActorIdentity;
  },
): Promise<SandboxGitIdentity> {
  const tables = getControlPlaneDatabaseSchema(db);
  const signingCredentialRows = await db
    .select({
      metadata: tables.userExternalPrincipalCredentialSecrets.metadata,
    })
    .from(tables.userExternalPrincipalCredentials)
    .innerJoin(
      tables.userExternalPrincipalCredentialSecrets,
      and(
        eq(tables.userExternalPrincipalCredentialSecrets.organizationId, input.organizationId),
        eq(
          tables.userExternalPrincipalCredentialSecrets.credentialId,
          tables.userExternalPrincipalCredentials.id,
        ),
        eq(
          tables.userExternalPrincipalCredentialSecrets.secretKind,
          UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
        ),
        isNull(tables.userExternalPrincipalCredentialSecrets.revokedAt),
      ),
    )
    .where(
      and(
        eq(tables.userExternalPrincipalCredentials.organizationId, input.organizationId),
        eq(tables.userExternalPrincipalCredentials.principalId, input.githubPrincipalId),
        eq(tables.userExternalPrincipalCredentials.providerFamily, GitHubProviderFamily),
        eq(tables.userExternalPrincipalCredentials.credentialKind, GitSshSigningCredentialKind),
        eq(
          tables.userExternalPrincipalCredentials.status,
          UserExternalPrincipalCredentialStatuses.ACTIVE,
        ),
      ),
    );

  if (signingCredentialRows.length > 1) {
    if (input.gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: input.userId,
        reason: "multiple active Git SSH signing credentials are configured",
      });
    }

    return input.actorIdentity;
  }

  const signingCredential = signingCredentialRows[0];
  if (signingCredential === undefined) {
    if (input.gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: input.userId,
        reason: "no active Git SSH signing credential is available",
      });
    }

    return input.actorIdentity;
  }

  const parsedSigningMetadata = GitSshSigningSecretMetadataSchema.safeParse(
    signingCredential.metadata ?? {},
  );
  if (!parsedSigningMetadata.success) {
    if (input.gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: input.userId,
        reason: "the Git SSH signing credential is missing public key metadata",
      });
    }

    return input.actorIdentity;
  }

  const publicKey = parsedSigningMetadata.data.publicKey.trim();
  if (publicKey.length === 0) {
    if (input.gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: input.userId,
        reason: "the Git SSH signing credential has an empty public key",
      });
    }

    return input.actorIdentity;
  }

  return {
    ...input.actorIdentity,
    signing: {
      format: "ssh",
      program: GitSigningProgram,
      keyRef: `key::${publicKey}`,
      organizationId: input.organizationId,
      providerFamily: GitHubProviderFamily,
      integrationConnectionId: input.githubProviderConfig.integrationConnectionId,
      actingUserId: input.userId,
    },
  };
}

async function resolveGitHubSigningProviderConfig(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    integrationConnectionId: string | null;
  },
): Promise<GitHubSigningProviderConfig | null> {
  if (input.integrationConnectionId === null) {
    return null;
  }

  const integrationConnectionId = input.integrationConnectionId;
  const [selectedConfig, selectedConnection] = await Promise.all([
    db.query.organizationIdentityLinkProviderConfigs.findFirst({
      columns: {
        id: true,
        integrationConnectionId: true,
        policy: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.providerFamily, GitHubProviderFamily),
          eq(table.integrationConnectionId, integrationConnectionId),
          eq(table.status, OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
        ),
    }),
    db.query.integrationConnections.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.id, integrationConnectionId),
          eq(table.status, IntegrationConnectionStatuses.ACTIVE),
        ),
    }),
  ]);

  if (selectedConfig === undefined || selectedConnection === undefined) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      "Selected GitHub commit-signing connection is not an active identity-linking configuration.",
    );
  }

  return selectedConfig;
}

async function resolveGitHubIdentityLinkProviderConfig(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    integrationConnectionId: string;
  },
): Promise<GitHubSigningProviderConfig | null> {
  const providerConfig = await db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      id: true,
      integrationConnectionId: true,
      policy: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, GitHubProviderFamily),
        eq(table.integrationConnectionId, input.integrationConnectionId),
        eq(table.status, OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
      ),
  });

  return providerConfig ?? null;
}
