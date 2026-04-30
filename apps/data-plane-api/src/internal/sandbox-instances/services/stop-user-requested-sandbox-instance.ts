import {
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  StopUserRequestedSandboxInstanceInput,
  StopUserRequestedSandboxInstanceResponse,
} from "../../sandbox/sandbox-instances/stop-user-requested-sandbox-instance/schema.js";

type StopUserRequestedSandboxInstanceContext = {
  db: DataPlaneDatabase;
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

const SandboxInstanceNotFoundErrorCode = "NOT_FOUND";
const SandboxInstanceUserStopNotSupportedErrorCode = "USER_STOP_NOT_SUPPORTED";

function createUserRequestedSandboxStopIdempotencyKey(
  input: StopUserRequestedSandboxInstanceInput,
): string {
  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "user_stop",
    organizationId: input.organizationId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function stopUserRequestedSandboxInstance(
  ctx: StopUserRequestedSandboxInstanceContext,
  input: StopUserRequestedSandboxInstanceInput,
): Promise<StopUserRequestedSandboxInstanceResponse> {
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      purpose: true,
      status: true,
    },
    where: (table, { and, eq: whereEq }) =>
      and(
        whereEq(table.id, input.sandboxInstanceId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (sandboxInstance === undefined) {
    throw new NotFoundError(
      SandboxInstanceNotFoundErrorCode,
      `Sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }

  if (sandboxInstance.purpose !== SandboxInstancePurposes.SETUP_CHECK) {
    throw new ConflictError(
      SandboxInstanceUserStopNotSupportedErrorCode,
      `User-requested stop is only supported for setup-check sandbox instances; sandbox instance '${input.sandboxInstanceId}' has purpose '${sandboxInstance.purpose}'.`,
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

  if (sandboxInstance.status !== SandboxInstanceStatuses.RUNNING) {
    throw new ConflictError(
      SandboxInstanceUserStopNotSupportedErrorCode,
      `Setup-check sandbox instance '${input.sandboxInstanceId}' is '${sandboxInstance.status}' and cannot be stopped yet.`,
    );
  }

  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    StopSandboxInstanceWorkflowSpec,
    {
      sandboxInstanceId: input.sandboxInstanceId,
      stopReason: "user",
    },
    {
      idempotencyKey: createUserRequestedSandboxStopIdempotencyKey(input),
    },
  );

  return {
    status: "accepted",
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
