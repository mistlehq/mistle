import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

import {
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../../../sandbox-instances/errors.js";

export async function getSandboxInstance(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<{
  id: string;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  failureCode: string | null;
  failureMessage: string | null;
}> {
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
