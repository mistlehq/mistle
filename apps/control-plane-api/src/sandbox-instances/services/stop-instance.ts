import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { DataPlaneSandboxInstancesClientError } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../errors.js";

export type StopInstanceResult = {
  status: "accepted" | "already_stopped" | "already_terminal";
  sandboxInstanceId: string;
  workflowRunId: string | null;
};

export async function stopInstance(
  {
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "stopUserRequestedSandboxInstance">;
  },
  input: {
    organizationId: string;
    instanceId: string;
    idempotencyKey: string;
  },
): Promise<StopInstanceResult> {
  try {
    return await dataPlaneClient.stopUserRequestedSandboxInstance({
      organizationId: input.organizationId,
      sandboxInstanceId: input.instanceId,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 404) {
      throw new SandboxInstancesNotFoundError(
        SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
        `Sandbox instance '${input.instanceId}' was not found or does not support user-requested stops.`,
      );
    }

    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 409) {
      throw new SandboxInstancesConflictError(
        SandboxInstancesConflictCodes.INSTANCE_STOP_NOT_SUPPORTED,
        `Sandbox instance '${input.instanceId}' cannot be stopped from its current state or purpose.`,
      );
    }

    throw error;
  }
}
