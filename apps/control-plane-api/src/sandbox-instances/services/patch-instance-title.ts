import {
  DataPlaneSandboxInstancesClientError,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";
import { BadRequestError } from "@mistle/http/errors.js";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "../errors.js";

type PatchInstanceTitleDependencies = {
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "patchSandboxInstanceTitle">;
};

type PatchInstanceTitleInput = {
  organizationId: string;
  instanceId: string;
  title: string;
};

export async function patchInstanceTitle(
  deps: PatchInstanceTitleDependencies,
  input: PatchInstanceTitleInput,
): Promise<{ id: string; title: string }> {
  try {
    return await deps.dataPlaneClient.patchSandboxInstanceTitle(input);
  } catch (error) {
    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 404) {
      throw new SandboxInstancesNotFoundError(
        SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
        `Sandbox instance '${input.instanceId}' was not found.`,
      );
    }

    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 400) {
      throw new BadRequestError("VALIDATION_ERROR", "Invalid request.");
    }

    throw error;
  }
}
