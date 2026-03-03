import { createTRPCClient, httpBatchLink, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

import { DATA_PLANE_INTERNAL_AUTH_HEADER, DATA_PLANE_TRPC_PATH } from "./constants.js";
import {
  GetSandboxInstanceInputSchema,
  GetSandboxInstanceResponseSchema,
  StartSandboxInstanceCompletedResponseSchema,
  StartSandboxInstanceInputSchema,
  type GetSandboxInstanceInput,
  type GetSandboxInstanceResponse,
  type StartSandboxInstanceCompletedResponse,
  type StartSandboxInstanceInput,
} from "./contracts/index.js";
import type { DataPlaneTrpcRouter } from "./router.js";

export interface DataPlaneTrpcClientOptions<TRouter extends AnyRouter> {
  links: TRPCLink<TRouter>[];
}

export function createDataPlaneClient<TRouter extends AnyRouter>(
  options: DataPlaneTrpcClientOptions<TRouter>,
) {
  return createTRPCClient<TRouter>({
    links: options.links,
  });
}

export function createDataPlaneTrpcUrl(baseUrl: string) {
  return new URL(DATA_PLANE_TRPC_PATH, baseUrl).toString();
}

export type DataPlaneSandboxInstancesClient = {
  startSandboxInstance: (
    input: StartSandboxInstanceInput,
  ) => Promise<StartSandboxInstanceCompletedResponse>;
  getSandboxInstance: (input: GetSandboxInstanceInput) => Promise<GetSandboxInstanceResponse>;
};

export type CreateDataPlaneSandboxInstancesClientInput = {
  baseUrl: string;
  serviceToken: string;
  links?: TRPCLink<DataPlaneTrpcRouter>[];
};

export function createDataPlaneSandboxInstancesClient(
  input: CreateDataPlaneSandboxInstancesClientInput,
): DataPlaneSandboxInstancesClient {
  const trpcClient = createTRPCClient<DataPlaneTrpcRouter>({
    links: input.links ?? [
      httpBatchLink({
        url: createDataPlaneTrpcUrl(input.baseUrl),
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: input.serviceToken,
        },
      }),
    ],
  });

  return {
    startSandboxInstance: async (startInput) => {
      const parsedStartInput = StartSandboxInstanceInputSchema.parse(startInput);
      const response = await trpcClient.sandboxInstances.start.mutate(parsedStartInput);

      return StartSandboxInstanceCompletedResponseSchema.parse(response);
    },
    getSandboxInstance: async (getInput) => {
      const parsedGetInput = GetSandboxInstanceInputSchema.parse(getInput);
      const response = await trpcClient.sandboxInstances.get.query(parsedGetInput);

      return GetSandboxInstanceResponseSchema.parse(response);
    },
  };
}
