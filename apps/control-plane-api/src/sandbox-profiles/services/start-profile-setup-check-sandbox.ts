import { randomUUID } from "node:crypto";

import { SandboxInstancePurposes, type SandboxInstanceSource } from "@mistle/db/data-plane";
import { type SandboxInstanceStarterKind } from "@mistle/db/data-plane";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import { SandboxProfilesCompileError, SandboxProfilesCompileErrorCodes } from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileSetupCheckSandboxInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  idempotencyKey?: string;
  requireAgentRuntime: boolean;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
};

type StartProfileSetupCheckSandboxOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

export async function startProfileSetupCheckSandbox(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: StartProfileSetupCheckSandboxInput,
): Promise<StartProfileSetupCheckSandboxOutput> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const compiledRuntimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      image: {
        source: "base",
        imageRef: defaultBaseImage,
      },
    },
  );
  if (input.requireAgentRuntime === true && compiledRuntimePlan.agentRuntimes.length === 0) {
    throw new SandboxProfilesCompileError(
      SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_REQUIRED,
      `Sandbox profile '${input.profileId}' version ${String(input.profileVersion)} does not declare an agent runtime. Add an agent integration binding before starting the Setup Assistant.`,
    );
  }
  const { setupScript: _setupScript, ...runtimePlanWithoutSetupScript } = compiledRuntimePlan;

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: input.organizationId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    purpose: SandboxInstancePurposes.SETUP_CHECK,
    idempotencyKey,
    runtimePlan: runtimePlanWithoutSetupScript,
    startedBy: input.startedBy,
    source: input.source,
    image: {
      imageId: defaultBaseImage,
      createdAt: new Date().toISOString(),
      kind: "base",
    },
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}
