import { randomUUID } from "node:crypto";

import {
  SandboxProfileVersionStates,
  type SandboxProfileVersionState,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  type SandboxInstanceSource,
  type SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";
import { type CompiledRuntimePlan, type ResolvedSandboxImage } from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";
import type {
  SandboxRuntimeProviderInput,
  StartSandboxInstanceWorkflowImageInput,
} from "@mistle/workflow-registry/data-plane";
import { and, eq } from "drizzle-orm";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import { SandboxProfilesCompileError, SandboxProfilesCompileErrorCodes } from "../errors.js";
import { SandboxProfilesBadRequestCodes, SandboxProfilesBadRequestError } from "../errors.js";
import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import {
  createWorkflowSandboxRuntime,
  mapProfileVersionRuntimeConfig,
} from "./profile-version-runtime-config.js";
import { listProfileVersionRepositoryOptions } from "./repository-options.js";
import {
  resolveActingUserGitIdentity,
  type SandboxActingUser,
} from "./resolve-acting-user-git-identity.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  primaryRepositoryId?: string | null;
  idempotencyKey?: string;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  actingUser?: SandboxActingUser;
  source: SandboxInstanceSource;
};

type StartProfileInstanceOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

type StartActiveProfileInstanceInput = Omit<StartProfileInstanceInput, "profileVersion">;

type ResolvedLaunchImage = {
  versionState: SandboxProfileVersionState;
  gitCommitSigningIntegrationConnectionId: string | null;
  compileImage: ResolvedSandboxImage;
  workflowImage: StartSandboxInstanceWorkflowImageInput;
  sandboxRuntime: SandboxRuntimeProviderInput;
};

const LaunchImageKinds = {
  BASE: "base",
  SNAPSHOT: "snapshot",
} as const;

function assertSnapshotImageProvider(
  provider: string,
): NonNullable<StartSandboxInstanceWorkflowImageInput["provider"]> {
  if (
    provider === SandboxProvider.DOCKER ||
    provider === SandboxProvider.E2B ||
    provider === SandboxProvider.TENSORLAKE
  ) {
    return provider;
  }

  throw new Error(`Unsupported persisted snapshot image provider '${provider}'.`);
}

async function resolveEffectiveRuntimePlan(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    primaryRepositoryId?: string | null;
    compiledRuntimePlan: CompiledRuntimePlan;
  },
): Promise<CompiledRuntimePlan> {
  if (input.primaryRepositoryId === undefined || input.primaryRepositoryId === null) {
    return input.compiledRuntimePlan;
  }

  const repositoryOptions = await listProfileVersionRepositoryOptions(
    {
      db,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    },
  );
  const primaryRepositoryPath =
    repositoryOptions.find((option) => option.id === input.primaryRepositoryId)?.path ?? null;
  if (primaryRepositoryPath === null) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
      `Primary repository '${input.primaryRepositoryId}' is not available for sandbox profile '${input.profileId}' version ${String(input.profileVersion)}.`,
    );
  }

  return {
    ...input.compiledRuntimePlan,
    agentRuntimes: input.compiledRuntimePlan.agentRuntimes.map((agentRuntime) => ({
      ...agentRuntime,
      ptyLaunch: {
        ...agentRuntime.ptyLaunch,
        newLaunch: {
          ...agentRuntime.ptyLaunch.newLaunch,
          cwd: primaryRepositoryPath,
        },
        resumeLaunch: {
          ...agentRuntime.ptyLaunch.resumeLaunch,
          cwd: primaryRepositoryPath,
        },
      },
    })),
  };
}

async function resolveLaunchImage(
  {
    db,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db"> & { defaultBaseImage: string },
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  },
): Promise<ResolvedLaunchImage> {
  const tables = getControlPlaneDatabaseSchema(db);

  const [sandboxProfileVersion] = await db
    .select({
      profileId: tables.sandboxProfiles.id,
      state: tables.sandboxProfileVersions.state,
      snapshotImageProvider: tables.sandboxProfileVersions.snapshotImageProvider,
      snapshotImageId: tables.sandboxProfileVersions.snapshotImageId,
      gitCommitSigningIntegrationConnectionId:
        tables.sandboxProfileVersions.gitCommitSigningIntegrationConnectionId,
      sandboxProvider: tables.sandboxProfileVersions.sandboxProvider,
      sandboxConnectionId: tables.sandboxProfileVersions.sandboxConnectionId,
      sandboxVcpuCount: tables.sandboxProfileVersions.sandboxVcpuCount,
      sandboxMemoryMb: tables.sandboxProfileVersions.sandboxMemoryMb,
      sandboxStorageMb: tables.sandboxProfileVersions.sandboxStorageMb,
    })
    .from(tables.sandboxProfiles)
    .leftJoin(
      tables.sandboxProfileVersions,
      and(
        eq(tables.sandboxProfileVersions.sandboxProfileId, tables.sandboxProfiles.id),
        eq(tables.sandboxProfileVersions.version, input.profileVersion),
      ),
    )
    .where(
      and(
        eq(tables.sandboxProfiles.id, input.profileId),
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
      ),
    );

  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  if (sandboxProfileVersion.state === null) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  const sandboxRuntime = createWorkflowSandboxRuntime(
    mapProfileVersionRuntimeConfig({
      sandboxProvider: sandboxProfileVersion.sandboxProvider,
      sandboxConnectionId: sandboxProfileVersion.sandboxConnectionId,
      sandboxVcpuCount: sandboxProfileVersion.sandboxVcpuCount,
      sandboxMemoryMb: sandboxProfileVersion.sandboxMemoryMb,
      sandboxStorageMb: sandboxProfileVersion.sandboxStorageMb,
    }),
  );

  if (sandboxProfileVersion.state === SandboxProfileVersionStates.PUBLISHED) {
    if (
      sandboxProfileVersion.snapshotImageProvider === null ||
      sandboxProfileVersion.snapshotImageId === null
    ) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
        `Sandbox profile version '${String(input.profileVersion)}' is published but not yet usable.`,
      );
    }

    const snapshotProvider = assertSnapshotImageProvider(
      sandboxProfileVersion.snapshotImageProvider,
    );
    if (snapshotProvider !== sandboxRuntime.provider) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
        `Sandbox profile version '${String(input.profileVersion)}' snapshot provider does not match its configured sandbox provider.`,
      );
    }

    return {
      versionState: sandboxProfileVersion.state,
      gitCommitSigningIntegrationConnectionId:
        sandboxProfileVersion.gitCommitSigningIntegrationConnectionId,
      compileImage: {
        source: "snapshot",
        imageRef: sandboxProfileVersion.snapshotImageId,
      },
      workflowImage: {
        imageId: sandboxProfileVersion.snapshotImageId,
        kind: LaunchImageKinds.SNAPSHOT,
        provider: snapshotProvider,
      },
      sandboxRuntime,
    };
  }

  return {
    versionState: sandboxProfileVersion.state,
    gitCommitSigningIntegrationConnectionId:
      sandboxProfileVersion.gitCommitSigningIntegrationConnectionId,
    compileImage: {
      source: "base",
      imageRef: defaultBaseImage,
    },
    workflowImage: {
      imageId: defaultBaseImage,
      createdAt: new Date().toISOString(),
      kind: LaunchImageKinds.BASE,
      provider: sandboxRuntime.provider,
    },
    sandboxRuntime,
  };
}

export async function startProfileInstance(
  {
    db,
    integrationsConfig,
    mcpConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<
    CreateSandboxProfilesServiceInput,
    "db" | "integrationsConfig" | "mcpConfig" | "dataPlaneClient"
  > & {
    defaultBaseImage: string;
  },
  serviceInput: StartProfileInstanceInput,
): Promise<StartProfileInstanceOutput> {
  const idempotencyKey = serviceInput.idempotencyKey ?? randomUUID();
  const launchImage = await resolveLaunchImage(
    {
      db,
      defaultBaseImage,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
    },
  );
  const compiledRuntimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
      mcpConfig,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
      image: launchImage.compileImage,
    },
  );
  if (compiledRuntimePlan.agentRuntimes.length === 0) {
    throw new SandboxProfilesCompileError(
      SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_REQUIRED,
      `Sandbox profile '${serviceInput.profileId}' version ${String(serviceInput.profileVersion)} does not declare an agent runtime. Add an agent integration binding before starting a session.`,
    );
  }
  const runtimePlan = await resolveEffectiveRuntimePlan(
    {
      db,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
      compiledRuntimePlan,
      ...(serviceInput.primaryRepositoryId === undefined
        ? {}
        : { primaryRepositoryId: serviceInput.primaryRepositoryId }),
    },
  );
  const gitIdentity = await resolveActingUserGitIdentity(db, {
    organizationId: serviceInput.organizationId,
    gitCommitSigningIntegrationConnectionId: launchImage.gitCommitSigningIntegrationConnectionId,
    ...(serviceInput.actingUser === undefined ? {} : { actingUser: serviceInput.actingUser }),
  });
  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: serviceInput.organizationId,
    sandboxProfileId: serviceInput.profileId,
    sandboxProfileVersion: serviceInput.profileVersion,
    purpose: SandboxInstancePurposes.SESSION,
    idempotencyKey,
    runtimePlan,
    startedBy: serviceInput.startedBy,
    ...(serviceInput.actingUser === undefined
      ? {}
      : { actingUserId: serviceInput.actingUser.userId }),
    ...(gitIdentity === undefined ? {} : { gitIdentity }),
    source: serviceInput.source,
    image: launchImage.workflowImage,
    sandboxRuntime: launchImage.sandboxRuntime,
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}

export async function startActiveProfileInstance(
  context: Pick<
    CreateSandboxProfilesServiceInput,
    "db" | "integrationsConfig" | "mcpConfig" | "dataPlaneClient"
  > & {
    defaultBaseImage: string;
  },
  serviceInput: StartActiveProfileInstanceInput,
): Promise<StartProfileInstanceOutput> {
  const profile = await context.db.query.sandboxProfiles.findFirst({
    columns: {
      activeVersion: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.id, serviceInput.profileId),
        eq(table.organizationId, serviceInput.organizationId),
      ),
  });

  if (profile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  if (profile.activeVersion === null) {
    throw new SandboxProfilesConflictError(
      SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
      `Sandbox profile '${serviceInput.profileId}' does not have an active version.`,
    );
  }

  return startProfileInstance(context, {
    ...serviceInput,
    profileVersion: profile.activeVersion,
  });
}
