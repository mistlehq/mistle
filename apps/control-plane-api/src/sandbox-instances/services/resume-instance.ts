import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { SandboxInstancesConflictCodes, SandboxInstancesConflictError } from "../errors.js";
import { getInstance } from "./get-instance.js";
import type { SandboxInstanceStatus } from "./types.js";

export async function resumeInstance(
  {
    db,
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "resumeSandboxInstance"
    >;
  },
  input: {
    organizationId: string;
    instanceId: string;
    idempotencyKey?: string;
  },
): Promise<SandboxInstanceStatus> {
  const sandboxInstance = await getInstance(
    {
      db,
      dataPlaneClient,
    },
    {
      organizationId: input.organizationId,
      instanceId: input.instanceId,
    },
  );

  if (sandboxInstance.status === "running" || sandboxInstance.status === "starting") {
    return sandboxInstance;
  }

  if (sandboxInstance.status === "pending") {
    throw createResumeNotResumableError(sandboxInstance);
  }

  if (sandboxInstance.status === "failed") {
    throw createResumeFailedError(sandboxInstance);
  }

  await dataPlaneClient.resumeSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });

  return {
    ...sandboxInstance,
    status: "starting",
    connectable: false,
    failureCode: null,
    failureMessage: null,
  };
}

function createResumeNotResumableError(
  sandboxInstance: Pick<SandboxInstanceStatus, "id" | "status">,
): SandboxInstancesConflictError {
  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
    `Sandbox instance '${sandboxInstance.id}' is '${sandboxInstance.status}' and cannot be resumed.`,
  );
}

function createResumeFailedError(
  sandboxInstance: Pick<SandboxInstanceStatus, "id" | "failureMessage">,
): SandboxInstancesConflictError {
  const failureMessage =
    sandboxInstance.failureMessage === null
      ? `Sandbox instance '${sandboxInstance.id}' failed and cannot be resumed.`
      : `Sandbox instance '${sandboxInstance.id}' failed and cannot be resumed: ${sandboxInstance.failureMessage}`;

  return new SandboxInstancesConflictError(
    SandboxInstancesConflictCodes.INSTANCE_FAILED,
    failureMessage,
  );
}
