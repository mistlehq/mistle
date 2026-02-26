import type { AnyRouter } from "@trpc/server";

import { createTRPCClient, type TRPCLink } from "@trpc/client";

import { DATA_PLANE_TRPC_PATH } from "./constants.js";

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
