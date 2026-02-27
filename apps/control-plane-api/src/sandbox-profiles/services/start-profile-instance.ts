import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { StartSandboxProfileInstanceWorkflowInput } from "@mistle/workflows/control-plane";

import { StartSandboxProfileInstanceWorkflowSpec } from "@mistle/workflows/control-plane";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

const START_SANDBOX_PROFILE_INSTANCE_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: StartSandboxProfileInstanceWorkflowInput["image"];
};

type StartProfileInstanceOutput = {
  status: "completed";
  workflowRunId: string;
  sandboxInstanceId: string;
  providerSandboxId: string;
};

function createIdempotencyKey(input: StartProfileInstanceInput): string {
  return JSON.stringify({
    organizationId: input.organizationId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    startedBy: {
      kind: input.startedBy.kind,
      id: input.startedBy.id,
    },
    source: input.source,
  });
}

export async function startProfileInstance(
  { openWorkflow }: Pick<CreateSandboxProfilesServiceInput, "openWorkflow">,
  serviceInput: StartProfileInstanceInput,
): Promise<StartProfileInstanceOutput> {
  const workflowRunHandle = await openWorkflow.runWorkflow(
    StartSandboxProfileInstanceWorkflowSpec,
    {
      organizationId: serviceInput.organizationId,
      sandboxProfileId: serviceInput.profileId,
      sandboxProfileVersion: serviceInput.profileVersion,
      startedBy: serviceInput.startedBy,
      source: serviceInput.source,
      image: serviceInput.image,
    },
    {
      idempotencyKey: createIdempotencyKey(serviceInput),
    },
  );
  const workflowResult = await workflowRunHandle.result({
    timeoutMs: START_SANDBOX_PROFILE_INSTANCE_WAIT_TIMEOUT_MS,
  });

  return {
    status: "completed",
    workflowRunId: workflowResult.workflowRunId,
    sandboxInstanceId: workflowResult.sandboxInstanceId,
    providerSandboxId: workflowResult.providerSandboxId,
  };
}
