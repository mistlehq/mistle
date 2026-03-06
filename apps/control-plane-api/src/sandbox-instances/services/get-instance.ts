import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "./errors.js";
import type { SandboxInstanceStatus } from "./types.js";

export async function getInstance(
  dataPlaneClient: DataPlaneSandboxInstancesClient,
  input: { organizationId: string; instanceId: string },
): Promise<SandboxInstanceStatus> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    throw new SandboxInstancesNotFoundError(
      SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  return {
    id: sandboxInstance.id,
    status: sandboxInstance.status,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
  };
}
