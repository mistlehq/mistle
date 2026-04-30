import { randomUUID } from "node:crypto";

import { SandboxInstancePurposes, type SandboxInstanceSource } from "@mistle/db/data-plane";
import { type SandboxInstanceStarterKind } from "@mistle/db/data-plane";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileSetupScriptTestRunInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  setupScript: string;
  idempotencyKey?: string;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
};

type StartProfileSetupScriptTestRunOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

export async function startProfileSetupScriptTestRun(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: StartProfileSetupScriptTestRunInput,
): Promise<StartProfileSetupScriptTestRunOutput> {
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
