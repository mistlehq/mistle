import { randomUUID } from "node:crypto";

import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import { type CompiledRuntimePlan, DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import { SandboxProfilesCompileError, SandboxProfilesCompileErrorCodes } from "../errors.js";
import { SandboxProfilesBadRequestCodes, SandboxProfilesBadRequestError } from "../errors.js";
import { listProfileVersionRepositoryOptions } from "./repository-options.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  primaryRepositoryId: string | null;
  idempotencyKey?: string;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
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

function applyRuntimePlanWorkingDirectory(
  runtimePlan: CompiledRuntimePlan,
  cwd: string,
): CompiledRuntimePlan {
  return {
    ...runtimePlan,
    agentRuntimes: runtimePlan.agentRuntimes.map((agentRuntime) => ({
      ...agentRuntime,
      ptyLaunch: {
        ...agentRuntime.ptyLaunch,
        newLaunch: {
          ...agentRuntime.ptyLaunch.newLaunch,
          cwd,
        },
        resumeLaunch: {
          ...agentRuntime.ptyLaunch.resumeLaunch,
          cwd,
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
  const repositoryOptions = await listProfileVersionRepositoryOptions(
    {
      db,
    },
    {
      organizationId: serviceInput.organizationId,
      profileId: serviceInput.profileId,
      profileVersion: serviceInput.profileVersion,
    },
  );
  const primaryRepositoryPath =
    serviceInput.primaryRepositoryId === null
      ? DefaultSandboxWorkspaceDir
      : (repositoryOptions.find((option) => option.id === serviceInput.primaryRepositoryId)?.path ??
        null);
  if (primaryRepositoryPath === null) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
      `Primary repository '${serviceInput.primaryRepositoryId}' is not available for sandbox profile '${serviceInput.profileId}' version ${String(serviceInput.profileVersion)}.`,
    );
  }

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
  const runtimePlan = applyRuntimePlanWorkingDirectory(compiledRuntimePlan, primaryRepositoryPath);

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: serviceInput.organizationId,
    sandboxProfileId: serviceInput.profileId,
    sandboxProfileVersion: serviceInput.profileVersion,
    idempotencyKey,
    runtimePlan,
    startedBy: serviceInput.startedBy,
    source: serviceInput.source,
    image: serviceInput.image,
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}
