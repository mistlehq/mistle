import {
  getControlPlaneDatabaseSchema,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  OrganizationIdentityLinkProviderConfigStatus,
  type IntegrationBindingKind,
  type ControlPlaneTransaction,
  type SandboxProfileVersionAgentRuntimeId,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { and, eq, inArray } from "drizzle-orm";

import { GitHubProviderFamily } from "../../identity-linking/github-signing.js";
import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { resolveGitCommitSigningPolicy } from "./git-signing-policy.js";
import { lockProfileVersionForUpdateOrThrow } from "./lock-profile-version-for-update.js";
import {
  replaceProfileVersionIntegrationBindings,
  validateProfileVersionIntegrationBindings,
} from "./profile-version-integration-bindings-write.js";
import {
  mapProfileVersionRuntimeConfig,
  type SandboxProfileVersionResources,
  validateSandboxProfileVersionRuntimeConfig,
} from "./profile-version-runtime-config.js";
import {
  mapProfileVersionSkillsConfig,
  type SandboxProfileVersionSkillsConfig,
} from "./profile-version-skills-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PutProfileVersionDraftInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  setupScript?: string | null;
  agentRuntimeId?: SandboxProfileVersionAgentRuntimeId;
  gitCommitSigningIntegrationConnectionId?: string | null;
  mistleMcpEnabled?: boolean;
  mistleMcpApiKeyId?: string | null;
  sandboxProvider?: string;
  sandboxConnectionId?: string | null;
  sandboxResources?: SandboxProfileVersionResources | null;
  skillsConfig?: SandboxProfileVersionSkillsConfig | null;
  integrationBindings?: {
    bindings: Array<{
      id?: string;
      clientRef?: string;
      connectionId: string;
      kind: IntegrationBindingKind;
      config: Record<string, unknown>;
    }>;
  };
};

type PutProfileVersionDraftOutput = {
  sandboxProfileId: string;
  version: number;
  setupScript: string | null;
  agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
  gitCommitSigningIntegrationConnectionId: string | null;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersionResources | null;
  skillsConfig: SandboxProfileVersionSkillsConfig | null;
  integrationBindings: Awaited<ReturnType<typeof replaceProfileVersionIntegrationBindings>>;
};

export async function putProfileVersionDraft(
  {
    db,
    integrationRegistry,
    sandboxConfig,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationRegistry" | "sandboxConfig">,
  input: PutProfileVersionDraftInput,
): Promise<PutProfileVersionDraftOutput> {
  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.profileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (sandboxProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  const validatedBindings =
    input.integrationBindings === undefined
      ? null
      : await validateProfileVersionIntegrationBindings(
          { db },
          {
            organizationId: input.organizationId,
            profileId: input.profileId,
            profileVersion: input.profileVersion,
            bindings: input.integrationBindings.bindings,
          },
        );

  return db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const lockedVersion = await lockProfileVersionForUpdateOrThrow({
      db: tx,
      tables,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    });

    if (lockedVersion.state !== SandboxProfileVersionStates.DRAFT) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const nextRuntimeConfig = mapProfileVersionRuntimeConfig({
      sandboxProvider: input.sandboxProvider ?? lockedVersion.sandboxProvider,
      sandboxConnectionId:
        input.sandboxConnectionId === undefined
          ? lockedVersion.sandboxConnectionId
          : input.sandboxConnectionId,
      sandboxVcpuCount:
        input.sandboxResources === undefined
          ? lockedVersion.sandboxVcpuCount
          : (input.sandboxResources?.vcpuCount ?? null),
      sandboxMemoryMb:
        input.sandboxResources === undefined
          ? lockedVersion.sandboxMemoryMb
          : (input.sandboxResources?.memoryMb ?? null),
      sandboxStorageMb:
        input.sandboxResources === undefined
          ? lockedVersion.sandboxStorageMb
          : (input.sandboxResources?.storageMb ?? null),
    });

    const runtimeConfigIssues = await validateSandboxProfileVersionRuntimeConfig(
      { db: tx, integrationRegistry, sandboxConfig },
      {
        organizationId: input.organizationId,
        runtimeConfig: nextRuntimeConfig,
      },
    );

    if (runtimeConfigIssues.length > 0) {
      const firstIssue = runtimeConfigIssues[0];
      if (firstIssue === undefined) {
        throw new Error("Expected sandbox runtime validation issue.");
      }

      throw new SandboxProfilesBadRequestError(
        SandboxProfilesBadRequestCodes.INVALID_SANDBOX_RUNTIME_CONFIG,
        firstIssue.message,
      );
    }

    const nextMistleMcpEnabled = input.mistleMcpEnabled ?? lockedVersion.mistleMcpEnabled;
    const nextMistleMcpApiKeyId =
      input.mistleMcpApiKeyId === undefined
        ? lockedVersion.mistleMcpApiKeyId
        : input.mistleMcpApiKeyId;
    await validateMistleMcpDraftConfig(tx, {
      apiKeyId: nextMistleMcpApiKeyId,
      enabled: nextMistleMcpEnabled,
      organizationId: input.organizationId,
    });
    const nextGitCommitSigningIntegrationConnectionId =
      input.gitCommitSigningIntegrationConnectionId === undefined
        ? lockedVersion.gitCommitSigningIntegrationConnectionId
        : input.gitCommitSigningIntegrationConnectionId;
    await validateGitCommitSigningDraftConfig(tx, {
      bindings:
        validatedBindings ??
        (await tx.query.sandboxProfileVersionIntegrationBindings.findMany({
          columns: {
            connectionId: true,
            kind: true,
          },
          where: (table, { and: whereAnd, eq: whereEq }) =>
            whereAnd(
              whereEq(table.sandboxProfileId, input.profileId),
              whereEq(table.sandboxProfileVersion, input.profileVersion),
            ),
        })),
      integrationConnectionId: nextGitCommitSigningIntegrationConnectionId,
      organizationId: input.organizationId,
    });

    const hasVersionFieldUpdate =
      input.setupScript !== undefined ||
      input.agentRuntimeId !== undefined ||
      input.gitCommitSigningIntegrationConnectionId !== undefined ||
      input.mistleMcpEnabled !== undefined ||
      input.mistleMcpApiKeyId !== undefined ||
      input.sandboxProvider !== undefined ||
      input.sandboxConnectionId !== undefined ||
      input.sandboxResources !== undefined ||
      input.skillsConfig !== undefined;

    if (hasVersionFieldUpdate) {
      const [updatedVersion] = await tx
        .update(tables.sandboxProfileVersions)
        .set({
          ...(input.setupScript === undefined ? {} : { setupScript: input.setupScript }),
          ...(input.agentRuntimeId === undefined ? {} : { agentRuntimeId: input.agentRuntimeId }),
          ...(input.gitCommitSigningIntegrationConnectionId === undefined
            ? {}
            : {
                gitCommitSigningIntegrationConnectionId:
                  input.gitCommitSigningIntegrationConnectionId,
              }),
          ...(input.mistleMcpEnabled === undefined
            ? {}
            : { mistleMcpEnabled: input.mistleMcpEnabled }),
          ...(input.mistleMcpApiKeyId === undefined
            ? {}
            : { mistleMcpApiKeyId: input.mistleMcpApiKeyId }),
          ...(input.sandboxProvider === undefined
            ? {}
            : { sandboxProvider: input.sandboxProvider }),
          ...(input.sandboxConnectionId === undefined
            ? {}
            : { sandboxConnectionId: input.sandboxConnectionId }),
          ...(input.sandboxResources === undefined
            ? {}
            : input.sandboxResources === null
              ? {
                  sandboxVcpuCount: null,
                  sandboxMemoryMb: null,
                  sandboxStorageMb: null,
                }
              : {
                  sandboxVcpuCount: input.sandboxResources.vcpuCount,
                  sandboxMemoryMb: input.sandboxResources.memoryMb,
                  sandboxStorageMb: input.sandboxResources.storageMb ?? null,
                }),
          ...(input.skillsConfig === undefined ? {} : { skillsConfig: input.skillsConfig }),
        })
        .where(
          and(
            eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
            eq(tables.sandboxProfileVersions.version, input.profileVersion),
          ),
        )
        .returning({
          sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
          version: tables.sandboxProfileVersions.version,
          setupScript: tables.sandboxProfileVersions.setupScript,
          agentRuntimeId: tables.sandboxProfileVersions.agentRuntimeId,
          gitCommitSigningIntegrationConnectionId:
            tables.sandboxProfileVersions.gitCommitSigningIntegrationConnectionId,
          mistleMcpEnabled: tables.sandboxProfileVersions.mistleMcpEnabled,
          mistleMcpApiKeyId: tables.sandboxProfileVersions.mistleMcpApiKeyId,
        });

      if (updatedVersion === undefined) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
          "Sandbox profile version was not found.",
        );
      }
    }

    const integrationBindings =
      input.integrationBindings === undefined
        ? {
            bindings: await tx.query.sandboxProfileVersionIntegrationBindings.findMany({
              where: (table, { and: whereAnd, eq: whereEq }) =>
                whereAnd(
                  whereEq(table.sandboxProfileId, input.profileId),
                  whereEq(table.sandboxProfileVersion, input.profileVersion),
                ),
              orderBy: (table, { asc }) => [asc(table.id)],
            }),
          }
        : await replaceProfileVersionIntegrationBindings(tx, {
            profileId: input.profileId,
            profileVersion: input.profileVersion,
            bindings: input.integrationBindings.bindings,
            validatedBindings: validatedBindings ?? [],
          });

    const persistedVersion = await tx.query.sandboxProfileVersions.findFirst({
      columns: {
        sandboxProfileId: true,
        version: true,
        setupScript: true,
        agentRuntimeId: true,
        gitCommitSigningIntegrationConnectionId: true,
        mistleMcpEnabled: true,
        mistleMcpApiKeyId: true,
        sandboxProvider: true,
        sandboxConnectionId: true,
        sandboxVcpuCount: true,
        sandboxMemoryMb: true,
        sandboxStorageMb: true,
        skillsConfig: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.sandboxProfileId, input.profileId),
          whereEq(table.version, input.profileVersion),
        ),
    });

    if (persistedVersion === undefined) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
        "Sandbox profile version was not found.",
      );
    }

    return {
      sandboxProfileId: persistedVersion.sandboxProfileId,
      version: persistedVersion.version,
      setupScript: persistedVersion.setupScript,
      agentRuntimeId: persistedVersion.agentRuntimeId,
      gitCommitSigningIntegrationConnectionId:
        persistedVersion.gitCommitSigningIntegrationConnectionId,
      mistleMcpEnabled: persistedVersion.mistleMcpEnabled,
      mistleMcpApiKeyId: persistedVersion.mistleMcpApiKeyId,
      ...mapProfileVersionRuntimeConfig(persistedVersion),
      skillsConfig: mapProfileVersionSkillsConfig(persistedVersion.skillsConfig),
      integrationBindings,
    };
  });
}

async function validateGitCommitSigningDraftConfig(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    integrationConnectionId: string | null;
    bindings: ReadonlyArray<{
      connectionId: string;
      kind: IntegrationBindingKind;
    }>;
  },
): Promise<void> {
  if (input.integrationConnectionId === null) {
    return;
  }

  const gitBinding = input.bindings.find((binding) => binding.kind === IntegrationBindingKinds.GIT);
  if (gitBinding === undefined) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      "Commit signing requires a GitHub Git connection binding on the sandbox profile.",
    );
  }

  if (gitBinding.connectionId !== input.integrationConnectionId) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      "Commit signing must use the same GitHub connection as the sandbox profile Git binding.",
    );
  }

  const gitHubConfigs = await db.query.organizationIdentityLinkProviderConfigs.findMany({
    columns: {
      integrationConnectionId: true,
      policy: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.providerFamily, GitHubProviderFamily),
        whereEq(table.status, OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
      ),
  });
  const activeConnectionIds = await listActiveConnectionIds(db, {
    organizationId: input.organizationId,
    integrationConnectionIds: gitHubConfigs.map((config) => config.integrationConnectionId),
  });
  const signingEligibleConfigs = gitHubConfigs.filter(
    (config) =>
      activeConnectionIds.has(config.integrationConnectionId) &&
      resolveGitCommitSigningPolicy({
        policy: config.policy ?? null,
        gitCommitSigningIntegrationConnectionId: config.integrationConnectionId,
      }).mode !== "disabled",
  );

  const selectedConfig = signingEligibleConfigs.find(
    (config) => config.integrationConnectionId === input.integrationConnectionId,
  );
  if (selectedConfig === undefined) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      "Selected GitHub commit-signing connection is not an active identity-linking configuration.",
    );
  }
}

async function listActiveConnectionIds(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    integrationConnectionIds: string[];
  },
): Promise<Set<string>> {
  if (input.integrationConnectionIds.length === 0) {
    return new Set();
  }

  const activeConnections = await db.query.integrationConnections.findMany({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.status, IntegrationConnectionStatuses.ACTIVE),
        inArray(table.id, input.integrationConnectionIds),
      ),
  });

  return new Set(activeConnections.map((connection) => connection.id));
}

async function validateMistleMcpDraftConfig(
  db: ControlPlaneTransaction,
  input: {
    enabled: boolean;
    apiKeyId: string | null;
    organizationId: string;
  },
): Promise<void> {
  if (!input.enabled) {
    return;
  }

  if (input.apiKeyId === null) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_MISTLE_MCP_CONFIG,
      "Select an API key before allowing the agent to interact with Mistle resources.",
    );
  }

  const apiKeyId = input.apiKeyId;
  const apiKey = await db.query.apiKeys.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq, gt, isNull, or }) =>
      whereAnd(
        whereEq(table.id, apiKeyId),
        whereEq(table.organizationId, input.organizationId),
        isNull(table.revokedAt),
        or(isNull(table.expiresAt), gt(table.expiresAt, new Date().toISOString())),
      ),
  });

  if (apiKey === undefined) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_MISTLE_MCP_CONFIG,
      "Selected Mistle MCP API key is not available.",
    );
  }
}

export type { PutProfileVersionDraftInput, PutProfileVersionDraftOutput };
