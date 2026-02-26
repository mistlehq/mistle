import { initTRPC } from "@trpc/server";

import type { DataPlaneTrpcContext } from "./context.js";

const t = initTRPC.context<DataPlaneTrpcContext>().create();

export const createDataPlaneTrpcRouter = t.router;
export const dataPlaneTrpcProcedure = t.procedure;

export const dataPlaneTrpcRouter = createDataPlaneTrpcRouter({});

export type DataPlaneTrpcRouter = typeof dataPlaneTrpcRouter;
