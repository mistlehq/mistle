import {
  DataPlaneSandboxInstancesClientError,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";

import { SandboxInstancesBadRequestCodes, SandboxInstancesBadRequestError } from "./errors.js";
import type { ListSandboxInstancesResult } from "./types.js";

export async function listInstances(
  dataPlaneClient: DataPlaneSandboxInstancesClient,
  input: {
    organizationId: string;
    limit?: number;
    after?: string;
    before?: string;
  },
): Promise<ListSandboxInstancesResult> {
  try {
    return await dataPlaneClient.listSandboxInstances({
      organizationId: input.organizationId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.after === undefined ? {} : { after: input.after }),
      ...(input.before === undefined ? {} : { before: input.before }),
    });
  } catch (error) {
    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 400) {
      throw new SandboxInstancesBadRequestError(
        SandboxInstancesBadRequestCodes.INVALID_LIST_INSTANCES_INPUT,
        error.body?.message ?? error.message,
      );
    }

    throw error;
  }
}
