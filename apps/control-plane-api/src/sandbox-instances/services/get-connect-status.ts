import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "./errors.js";
import type { SandboxInstanceConnectStatus } from "./types.js";

export async function getConnectStatus(
  dataPlaneClient: DataPlaneSandboxInstancesClient,
  input: { organizationId: string; instanceId: string },
): Promise<SandboxInstanceConnectStatus> {
  const connectStatus = await dataPlaneClient.getSandboxConnectStatus({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (connectStatus === null) {
    throw new SandboxInstancesNotFoundError(
      SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  return connectStatus;
}
