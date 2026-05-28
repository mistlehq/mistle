import {
  SandboxInstancePurposes,
  type DataPlaneDatabase,
  type SandboxInstancePurpose,
} from "@mistle/db/data-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import { SandboxInstanceStatuses, isSandboxUserStopEligible } from "@mistle/sandbox-lifecycle";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  StopSandboxInstanceInput,
  StopSandboxInstanceResponse,
} from "../stop-sandbox-instance/schema.js";

type StopSandboxInstanceContext = {
  db: DataPlaneDatabase;
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

const SandboxInstanceNotFoundErrorCode = "NOT_FOUND";
const SandboxInstanceUserStopNotSupportedErrorCode = "USER_STOP_NOT_SUPPORTED";

function createStopSandboxIdempotencyKey(input: StopSandboxInstanceInput): string {
  if (input.stopReason === "user") {
    return JSON.stringify({
      version: 1,
      sandboxInstanceId: input.sandboxInstanceId,
      action: "user_stop",
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "stop",
    stopReason: input.stopReason,
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    idempotencyKey: input.idempotencyKey,
  });
}

function supportsUserRequestedStop(purpose: SandboxInstancePurpose): boolean {
  return (
    purpose === SandboxInstancePurposes.SESSION ||
    purpose === SandboxInstancePurposes.SETUP_ASSISTANT ||
    purpose === SandboxInstancePurposes.SETUP_CHECK
  );
}

export async function stopSandboxInstance(
  ctx: StopSandboxInstanceContext,
  input: StopSandboxInstanceInput,
): Promise<StopSandboxInstanceResponse> {
  if (input.stopReason === "user") {
    const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        purpose: true,
        status: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.id, input.sandboxInstanceId), eq(table.organizationId, input.organizationId)),
    });

    if (sandboxInstance === undefined) {
      throw new NotFoundError(
        SandboxInstanceNotFoundErrorCode,
        `Sandbox instance '${input.sandboxInstanceId}' was not found.`,
      );
    }

    if (!supportsUserRequestedStop(sandboxInstance.purpose)) {
      throw new ConflictError(
        SandboxInstanceUserStopNotSupportedErrorCode,
        `User-requested stop is only supported for session, setup-check, and setup-assistant sandbox instances; sandbox instance '${input.sandboxInstanceId}' has purpose '${sandboxInstance.purpose}'.`,
      );
    }

    if (sandboxInstance.status === SandboxInstanceStatuses.STOPPED) {
      return {
        status: "already_stopped",
        sandboxInstanceId: input.sandboxInstanceId,
        workflowRunId: null,
      };
    }

    if (sandboxInstance.status === SandboxInstanceStatuses.FAILED) {
      return {
        status: "already_terminal",
        sandboxInstanceId: input.sandboxInstanceId,
        workflowRunId: null,
      };
    }

    if (!isSandboxUserStopEligible(sandboxInstance.status)) {
      throw new ConflictError(
        SandboxInstanceUserStopNotSupportedErrorCode,
        `Sandbox instance '${input.sandboxInstanceId}' is '${sandboxInstance.status}' and cannot be stopped yet.`,
      );
    }
  }

  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    StopSandboxInstanceWorkflowSpec,
    input.stopReason === "idle"
      ? {
          sandboxInstanceId: input.sandboxInstanceId,
          stopReason: input.stopReason,
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        }
      : {
          sandboxInstanceId: input.sandboxInstanceId,
          stopReason: input.stopReason,
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
