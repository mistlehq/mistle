import { createDataPlaneTrpcRouter as createDataPlaneTrpcContractRouter } from "@mistle/data-plane-trpc/router";

import { createDataPlaneTrpcRouter as createDataPlaneTrpcAppRouter } from "./base.js";
import { sandboxInstancesTrpcRouter } from "./routers/sandbox-instances.js";

export const dataPlaneTrpcRouter = createDataPlaneTrpcContractRouter({
  createRouter: createDataPlaneTrpcAppRouter,
  sandboxInstances: sandboxInstancesTrpcRouter,
});

export type DataPlaneTrpcRouter = typeof dataPlaneTrpcRouter;
