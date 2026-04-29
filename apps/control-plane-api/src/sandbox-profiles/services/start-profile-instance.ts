import { randomUUID } from "node:crypto";

import {
  sandboxProfiles,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
  type SandboxProfileVersionState,
} from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  type SandboxInstancePurpose,
  type SandboxInstanceSource,
  type SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";
import { type CompiledRuntimePlan, type ResolvedSandboxImage } from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowImageInput } from "@mistle/workflow-registry/data-plane";
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
  purpose?: SandboxInstancePurpose;
  setupScript?: string | null;
  forceBaseImage?: boolean;
};

type StartProfileInstanceOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

type ResolvedLaunchImage = {
  versionState: SandboxProfileVersionState;
  compileImage: ResolvedSandboxImage;
  workflowImage: StartSandboxInstanceWorkflowImageInput;
};

type ResolveEffectiveRuntimePlanInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  primaryRepositoryId?: string | null;
  compiledRuntimePlan: CompiledRuntimePlan;
  setupScript?: string | null;
};

const LaunchImageKinds = {
  BASE: "base",
  SNAPSHOT: "snapshot",
} as const;

function normalizeSetupScript(setupScript: string | null): string | undefined {
  if (setupScript === null || setupScript.trim().length === 0) {
    return undefined;
  }

  return setupScript;
}

function applySetupScriptOverride(
  runtimePlan: CompiledRuntimePlan,
  setupScript: string | null,
): CompiledRuntimePlan {
  const normalizedSetupScript = normalizeSetupScript(setupScript);
  const { setupScript: _existingSetupScript, ...runtimePlanWithoutSetupScript } = runtimePlan;

  return {
    ...runtimePlanWithoutSetupScript,
    ...(normalizedSetupScript === undefined ? {} : { setupScript: normalizedSetupScript }),
  };
}

function assertSnapshotImageProvider(
  provider: string,
): NonNullable<StartSandboxInstanceWorkflowImageInput["provider"]> {
  if (provider === SandboxProvider.DOCKER || provider === SandboxProvider.E2B) {
    return provider;
  }

  throw new Error(`Unsupported persisted snapshot image provider '${provider}'.`);
}

async function resolveEffectiveRuntimePlan(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: ResolveEffectiveRuntimePlanInput,
): Promise<CompiledRuntimePlan> {
  const runtimePlan =
    input.setupScript === undefined
      ? input.compiledRuntimePlan
      : applySetupScriptOverride(input.compiledRuntimePlan, input.setupScript);

  if (input.primaryRepositoryId === undefined || input.primaryRepositoryId === null) {
    return runtimePlan;
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
    ...runtimePlan,
    agentRuntimes: runtimePlan.agentRuntimes.map((agentRuntime) => ({
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
    forceBaseImage?: boolean;
  },
): Promise<ResolvedLaunchImage> {
  const [sandboxProfileVersion] = await db
    .select({
      profileId: sandboxProfiles.id,
      state: sandboxProfileVersions.state,
      snapshotImageProvider: sandboxProfileVersions.snapshotImageProvider,
      snapshotImageId: sandboxProfileVersions.snapshotImageId,
    })
    .from(sandboxProfiles)
    .leftJoin(
      sandboxProfileVersions,
      and(
        eq(sandboxProfileVersions.sandboxProfileId, sandboxProfiles.id),
        eq(sandboxProfileVersions.version, input.profileVersion),
      ),
    )
    .where(
      and(
        eq(sandboxProfiles.id, input.profileId),
        eq(sandboxProfiles.organizationId, input.organizationId),
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

  if (input.forceBaseImage === true) {
    return {
      versionState: sandboxProfileVersion.state,
      compileImage: {
        source: "base",
        imageRef: defaultBaseImage,
      },
      workflowImage: {
        imageId: defaultBaseImage,
        createdAt: new Date().toISOString(),
        kind: LaunchImageKinds.BASE,
      },
    };
  }

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

    return {
      versionState: sandboxProfileVersion.state,
      compileImage: {
        source: "snapshot",
        imageRef: sandboxProfileVersion.snapshotImageId,
      },
      workflowImage: {
        imageId: sandboxProfileVersion.snapshotImageId,
        kind: LaunchImageKinds.SNAPSHOT,
        provider: assertSnapshotImageProvider(sandboxProfileVersion.snapshotImageProvider),
      },
    };
  }

  return {
    versionState: sandboxProfileVersion.state,
    compileImage: {
      source: "base",
      imageRef: defaultBaseImage,
    },
    workflowImage: {
      imageId: defaultBaseImage,
      createdAt: new Date().toISOString(),
      kind: LaunchImageKinds.BASE,
    },
  };
}

export async function startProfileInstance(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  serviceInput: StartProfileInstanceInput,
): Promise<StartProfileInstanceOutput> {
  const idempotencyKey = serviceInput.idempotencyKey ?? randomUUID();
  const purpose = serviceInput.purpose ?? SandboxInstancePurposes.SESSION;
  const launchImage = await resolveLaunchImage(
    {
      db,
      defaultBaseImage,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
      ...(serviceInput.forceBaseImage === undefined
        ? {}
        : { forceBaseImage: serviceInput.forceBaseImage }),
    },
  );
  const compiledRuntimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
      image: launchImage.compileImage,
    },
  );
  if (
    purpose === SandboxInstancePurposes.SESSION &&
    compiledRuntimePlan.agentRuntimes.length === 0
  ) {
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
      ...(serviceInput.setupScript === undefined ? {} : { setupScript: serviceInput.setupScript }),
    },
  );
  const gitIdentity = await resolveActingUserGitIdentity(db, {
    organizationId: serviceInput.organizationId,
    ...(serviceInput.actingUser === undefined ? {} : { actingUser: serviceInput.actingUser }),
  });

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: serviceInput.organizationId,
    sandboxProfileId: serviceInput.profileId,
    sandboxProfileVersion: serviceInput.profileVersion,
    purpose,
    idempotencyKey,
    runtimePlan,
    startedBy: serviceInput.startedBy,
    ...(serviceInput.actingUser === undefined
      ? {}
      : { actingUserId: serviceInput.actingUser.userId }),
    ...(gitIdentity === undefined ? {} : { gitIdentity }),
    source: serviceInput.source,
    image: launchImage.workflowImage,
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}
