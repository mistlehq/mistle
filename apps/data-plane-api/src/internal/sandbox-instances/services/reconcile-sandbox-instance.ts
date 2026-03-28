import { ReconcileSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  ReconcileSandboxInstanceAcceptedResponse,
  ReconcileSandboxInstanceInput,
} from "../reconcile-sandbox-instance/schema.js";

type ReconcileSandboxInstanceContext = {
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

function createReconcileSandboxIdempotencyKey(input: ReconcileSandboxInstanceInput): string {
  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "reconcile",
    reason: input.reason,
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function reconcileSandboxInstance(
  ctx: ReconcileSandboxInstanceContext,
  input: ReconcileSandboxInstanceInput,
): Promise<ReconcileSandboxInstanceAcceptedResponse> {
  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    ReconcileSandboxInstanceWorkflowSpec,
    {
      sandboxInstanceId: input.sandboxInstanceId,
      reason: input.reason,
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    },
    {
      idempotencyKey: createReconcileSandboxIdempotencyKey(input),
    },
  );

  return {
    status: "accepted",
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
