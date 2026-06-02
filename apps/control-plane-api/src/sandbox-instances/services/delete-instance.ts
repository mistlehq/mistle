import type {
  DataPlaneSandboxInstancesClient,
  DeleteSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";
import { DataPlaneSandboxInstancesClientError } from "@mistle/data-plane-internal-client";
import { SandboxInstancePurposes } from "@mistle/db/data-plane";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "../errors.js";

export async function deleteInstance(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "deleteSandboxInstance" | "getSandboxInstanceMetadata"
    >;
  },
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<DeleteSandboxInstanceResponse> {
  try {
    const sandboxInstance = await dataPlaneClient.getSandboxInstanceMetadata({
      organizationId: input.organizationId,
      instanceId: input.instanceId,
    });
    if (sandboxInstance === null || sandboxInstance.purpose !== SandboxInstancePurposes.SESSION) {
      throw new SandboxInstancesNotFoundError(
        SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
        `Sandbox instance '${input.instanceId}' was not found.`,
      );
    }

    return await dataPlaneClient.deleteSandboxInstance({
      organizationId: input.organizationId,
      sandboxInstanceId: input.instanceId,
    });
  } catch (error) {
    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 404) {
      throw new SandboxInstancesNotFoundError(
        SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
        `Sandbox instance '${input.instanceId}' was not found.`,
      );
    }

    throw error;
  }
}
