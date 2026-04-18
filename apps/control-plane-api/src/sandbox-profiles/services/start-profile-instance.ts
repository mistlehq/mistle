import { randomUUID } from "node:crypto";

import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import { type CompiledRuntimePlan } from "@mistle/integrations-core";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import { SandboxProfilesCompileError, SandboxProfilesCompileErrorCodes } from "../errors.js";
import { SandboxProfilesBadRequestCodes, SandboxProfilesBadRequestError } from "../errors.js";
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
  image: {
    imageId: string;
    createdAt: string;
  };
};

type StartProfileInstanceOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

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

export async function startProfileInstance(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient">,
  serviceInput: StartProfileInstanceInput,
): Promise<StartProfileInstanceOutput> {
  const idempotencyKey = serviceInput.idempotencyKey ?? randomUUID();
  const compiledRuntimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
      image: {
        source: "base",
        imageRef: serviceInput.image.imageId,
      },
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
    ...(serviceInput.actingUser === undefined ? {} : { actingUser: serviceInput.actingUser }),
  });

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: serviceInput.organizationId,
    sandboxProfileId: serviceInput.profileId,
    sandboxProfileVersion: serviceInput.profileVersion,
    idempotencyKey,
    runtimePlan,
    startedBy: serviceInput.startedBy,
    ...(gitIdentity === undefined ? {} : { gitIdentity }),
    source: serviceInput.source,
    image: serviceInput.image,
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}
