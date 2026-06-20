import {
  DataPlaneSandboxInstancesClientError,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";
import type { SandboxInstancePurpose } from "@mistle/db/data-plane";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "../errors.js";

type ListOperationEventsContext = {
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "listSandboxOperationEvents">;
};

type ListOperationEventsInput = {
  organizationId: string;
  sandboxInstanceId: string;
  operationId: string;
  allowedPurposes?: readonly SandboxInstancePurpose[];
  afterSequence?: number;
  limit?: number;
};

export async function listOperationEvents(
  ctx: ListOperationEventsContext,
  input: ListOperationEventsInput,
) {
  try {
    return await ctx.dataPlaneClient.listSandboxOperationEvents({
      organizationId: input.organizationId,
      sandboxInstanceId: input.sandboxInstanceId,
      operationId: input.operationId,
      ...(input.allowedPurposes === undefined ? {} : { allowedPurposes: input.allowedPurposes }),
      ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  } catch (error) {
    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 404) {
      throw new SandboxInstancesNotFoundError(
        SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
        `Sandbox instance '${input.sandboxInstanceId}' was not found.`,
      );
    }

    throw error;
  }
}
