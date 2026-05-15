import {
  DataPlaneSandboxInstancesClientError,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "../errors.js";

type ListOperationEventsContext = {
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "listSandboxOperationEvents">;
};

type ListOperationEventsInput = {
  organizationId: string;
  sandboxInstanceId: string;
  operationId: string;
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
