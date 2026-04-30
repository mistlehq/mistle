import { SandboxInstancePurposes, SandboxInstanceStatuses } from "@mistle/db/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  SetupCheckPtyDrainedInput,
  SetupCheckPtyDrainedResponse,
} from "../setup-check-pty-drained/schema.js";
import { stopSandboxInstance } from "./stop-sandbox-instance.js";

type SetupCheckPtyDrainedContext = {
  db: AppRuntimeResources["db"];
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

function createSetupCheckPtyDrainedIdempotencyKey(input: SetupCheckPtyDrainedInput): string {
  return `setup-check-pty-drained:v1:${input.sandboxInstanceId}:${input.ownerLeaseId}`;
}

export async function handleSetupCheckPtyDrained(
  ctx: SetupCheckPtyDrainedContext,
  input: SetupCheckPtyDrainedInput,
): Promise<SetupCheckPtyDrainedResponse> {
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      purpose: true,
      status: true,
    },
    where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance === undefined) {
    return {
      status: "ignored",
      sandboxInstanceId: input.sandboxInstanceId,
    };
  }

  if (sandboxInstance.purpose !== SandboxInstancePurposes.SETUP_CHECK) {
    return {
      status: "ignored",
      sandboxInstanceId: input.sandboxInstanceId,
    };
  }

  if (
    sandboxInstance.status === SandboxInstanceStatuses.STOPPED ||
    sandboxInstance.status === SandboxInstanceStatuses.FAILED
  ) {
    return {
      status: "ignored",
      sandboxInstanceId: input.sandboxInstanceId,
    };
  }

  const stopResponse = await stopSandboxInstance(ctx, {
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: "idle",
    expectedOwnerLeaseId: input.ownerLeaseId,
    idempotencyKey: createSetupCheckPtyDrainedIdempotencyKey(input),
  });

  return {
    status: "accepted",
    sandboxInstanceId: stopResponse.sandboxInstanceId,
    workflowRunId: stopResponse.workflowRunId,
  };
}
