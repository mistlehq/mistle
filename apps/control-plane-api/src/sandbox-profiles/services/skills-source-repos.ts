import { randomUUID } from "node:crypto";

import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  type ControlPlaneDatabase,
  type SandboxProfileVersionSkillsConfig,
  type SkillsSourceRepo,
} from "@mistle/db/control-plane";
import type { SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { ResolvedSandboxImage } from "@mistle/integrations-core";

import { SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS } from "../../sandbox-instances/constants.js";
import { syncSkillsSourceRepo } from "../../skills-source-repos/services/sync-skills-source-repo.js";
import type { ControlPlaneApiConfig } from "../../types.js";
import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import {
  type SandboxProfileVersionRuntimeConfigColumns,
  createWorkflowSandboxRuntime,
  mapProfileVersionRuntimeConfig,
} from "./profile-version-runtime-config.js";
import { mapProfileVersionSkillsConfig } from "./profile-version-skills-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type SkillsSourceRepoResponse = {
  id: string;
  originUrl: string;
  commitSha: string | null;
  skills: SkillsSourceRepo["skills"];
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProfileVersionContext = SandboxProfileVersionRuntimeConfigColumns & {
  skillsConfig: SandboxProfileVersionSkillsConfig | null;
};

export type ListProfileVersionSkillsSourceReposInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  originUrl?: string;
};

export type ListProfileVersionSkillsSourceReposOutput = {
  items: SkillsSourceRepoResponse[];
};

export type RefreshProfileVersionSkillsSourceRepoInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  originUrl: string;
  idempotencyKey?: string;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
};

export type RefreshProfileVersionSkillsSourceRepoOutput = {
  sandboxInstanceId: string;
  workflowRunId: string;
  skillsSourceRepo: SkillsSourceRepoResponse;
};

export async function listProfileVersionSkillsSourceRepos(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: ListProfileVersionSkillsSourceReposInput,
): Promise<ListProfileVersionSkillsSourceReposOutput> {
  await assertProfileVersionExists(db, input);

  const items = await db.query.skillsSourceRepos.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        input.originUrl === undefined ? undefined : eq(table.originUrl, input.originUrl),
      ),
    orderBy: (table, { asc }) => [asc(table.originUrl), asc(table.id)],
  });

  return {
    items: items.map(mapSkillsSourceRepoResponse),
  };
}

export async function refreshProfileVersionSkillsSourceRepo(
  context: Pick<
    CreateSandboxProfilesServiceInput,
    "cache" | "db" | "integrationsConfig" | "mcpConfig"
  > & {
    connectionTokenConfig: ConnectionTokenConfig;
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      | "deleteSandboxInstance"
      | "getSandboxInstance"
      | "resumeSandboxInstance"
      | "startSandboxInstance"
    >;
    defaultBaseImage: string;
    gatewayWebsocketUrl: string;
  },
  input: RefreshProfileVersionSkillsSourceRepoInput,
): Promise<RefreshProfileVersionSkillsSourceRepoOutput> {
  const profileVersion = await getProfileVersionContext(context.db, input);
  const skillsConfig = profileVersion.skillsConfig;
  if (skillsConfig === null || skillsConfig.originUrl !== input.originUrl) {
    throw new SandboxProfilesConflictError(
      SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
      `Sandbox profile version does not include skills source '${input.originUrl}'.`,
    );
  }
  const image: ResolvedSandboxImage = {
    source: "base",
    imageRef: context.defaultBaseImage,
  };
  const runtimePlan = await compileProfileVersionRuntimePlan(
    {
      db: context.db,
      integrationsConfig: context.integrationsConfig,
      mcpConfig: context.mcpConfig,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      image,
    },
  );
  assertRuntimePlanIncludesSkillsSourceRepo(runtimePlan, input.originUrl);
  const sandboxRuntime = createWorkflowSandboxRuntime(
    mapProfileVersionRuntimeConfig(profileVersion),
  );

  const output = await syncSkillsSourceRepo(
    {
      db: context.db,
      cache: context.cache,
      dataPlaneClient: context.dataPlaneClient,
      gatewayWebsocketUrl: context.gatewayWebsocketUrl,
      connectionTokenConfig: context.connectionTokenConfig,
      connectionTokenTtlSeconds: SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS,
      integrationsConfig: context.integrationsConfig,
    },
    {
      organizationId: input.organizationId,
      originUrl: input.originUrl,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
      runtimePlan,
      sandboxRuntime,
      image: {
        imageId: context.defaultBaseImage,
        kind: "base",
        provider: sandboxRuntime.provider,
      },
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      startedBy: input.startedBy,
      source: "dashboard",
    },
  );

  return {
    sandboxInstanceId: output.sandboxInstanceId,
    workflowRunId: output.workflowRunId,
    skillsSourceRepo: mapSkillsSourceRepoResponse(output.skillsSourceRepo),
  };
}

function assertRuntimePlanIncludesSkillsSourceRepo(
  runtimePlan: {
    workspaceSources: ReadonlyArray<{
      originUrl: string;
    }>;
  },
  originUrl: string,
): void {
  const matchingSources = runtimePlan.workspaceSources.filter(
    (workspaceSource) => workspaceSource.originUrl === originUrl,
  );
  if (matchingSources.length !== 1) {
    throw new SandboxProfilesConflictError(
      SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
      `Sandbox profile version does not include skills source '${originUrl}'.`,
    );
  }
}

export function mapSkillsSourceRepoResponse(
  skillsSourceRepo: SkillsSourceRepo,
): SkillsSourceRepoResponse {
  return {
    id: skillsSourceRepo.id,
    originUrl: skillsSourceRepo.originUrl,
    commitSha: skillsSourceRepo.commitSha,
    skills: skillsSourceRepo.skills,
    lastSyncedAt: skillsSourceRepo.lastSyncedAt,
    createdAt: skillsSourceRepo.createdAt,
    updatedAt: skillsSourceRepo.updatedAt,
  };
}

async function getProfileVersionContext(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  },
): Promise<ProfileVersionContext> {
  await assertProfileExists(db, input);

  const profileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProvider: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxDiskMb: true,
      skillsConfig: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
  });

  if (profileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  return {
    ...profileVersion,
    skillsConfig: mapProfileVersionSkillsConfig(profileVersion.skillsConfig),
  };
}

async function assertProfileVersionExists(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  },
): Promise<void> {
  await assertProfileExists(db, input);
  await assertProfileVersionExistsForProfile(db, input);
}

async function assertProfileExists(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    profileId: string;
  },
): Promise<void> {
  const profile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
  });

  if (profile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }
}

async function assertProfileVersionExistsForProfile(
  db: ControlPlaneDatabase,
  input: {
    profileId: string;
    profileVersion: number;
  },
): Promise<void> {
  const profileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
  });

  if (profileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }
}

export function createSkillsSourceRepoConnectionTokenConfig(
  config: ControlPlaneApiConfig["connectionToken"],
): ConnectionTokenConfig {
  return {
    connectionTokenSecret: config.secret,
    tokenIssuer: config.issuer,
    tokenAudience: config.audience,
  };
}
