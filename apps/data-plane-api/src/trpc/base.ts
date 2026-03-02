import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-trpc/constants";
import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import type { DataPlaneTrpcContext } from "./context.js";

const t = initTRPC.context<DataPlaneTrpcContext>().create();

const requireInternalAuthMiddleware = t.middleware(async ({ ctx, next }) => {
  const providedServiceToken = ctx.requestHeaders.get(DATA_PLANE_INTERNAL_AUTH_HEADER);

  if (providedServiceToken === null || providedServiceToken !== ctx.internalAuthServiceToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  }

  return next();
});

export const createDataPlaneTrpcRouter = t.router;
export const dataPlaneTrpcProcedure = t.procedure.use(requireInternalAuthMiddleware);
