import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  StopSandboxInstanceAcceptedResponse,
  StopSandboxInstanceInput,
} from "../stop-sandbox-instance/schema.js";

type StopSandboxInstanceContext = {
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

function createStopSandboxIdempotencyKey(input: StopSandboxInstanceInput): string {
  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "stop",
    stopReason: input.stopReason,
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function stopSandboxInstance(
  ctx: StopSandboxInstanceContext,
  input: StopSandboxInstanceInput,
): Promise<StopSandboxInstanceAcceptedResponse> {
  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    StopSandboxInstanceWorkflowSpec,
    {
      sandboxInstanceId: input.sandboxInstanceId,
      stopReason: input.stopReason,
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    },
    {
      idempotencyKey: createStopSandboxIdempotencyKey(input),
    },
  );

  return {
    status: "accepted",
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
