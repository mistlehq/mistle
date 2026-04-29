import { BadRequestError } from "@mistle/http/errors.js";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  StopSandboxInstanceAcceptedResponse,
  StopSandboxInstanceInput,
} from "../stop-sandbox-instance/schema.js";

type StopSandboxInstanceContext = {
  db: AppRuntimeResources["db"];
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

function createStopSandboxIdempotencyKey(input: StopSandboxInstanceInput): string {
  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "stop",
    stopReason: input.stopReason,
    idempotencyKey: input.idempotencyKey,
    ...(input.stopReason === "idle" ? { expectedOwnerLeaseId: input.expectedOwnerLeaseId } : {}),
  });
}

async function verifyExpectedSandboxPurpose(
  ctx: Pick<StopSandboxInstanceContext, "db">,
  input: Pick<StopSandboxInstanceInput, "sandboxInstanceId" | "expectedPurpose">,
): Promise<void> {
  if (input.expectedPurpose === undefined) {
    return;
  }

  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      purpose: true,
    },
    where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance === undefined) {
    throw new BadRequestError("SANDBOX_INSTANCE_NOT_FOUND", "Sandbox instance was not found.");
  }

  if (sandboxInstance.purpose === input.expectedPurpose) {
    return;
  }

  throw new BadRequestError(
    "SANDBOX_INSTANCE_PURPOSE_MISMATCH",
    `Sandbox instance '${input.sandboxInstanceId}' has purpose '${sandboxInstance.purpose}', not '${input.expectedPurpose}'.`,
  );
}

export async function stopSandboxInstance(
  ctx: StopSandboxInstanceContext,
  input: StopSandboxInstanceInput,
): Promise<StopSandboxInstanceAcceptedResponse> {
  await verifyExpectedSandboxPurpose(ctx, input);

  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    StopSandboxInstanceWorkflowSpec,
    {
      sandboxInstanceId: input.sandboxInstanceId,
      stopReason: input.stopReason,
      ...(input.stopReason === "idle" ? { expectedOwnerLeaseId: input.expectedOwnerLeaseId } : {}),
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
