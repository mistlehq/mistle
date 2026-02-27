import { createDataPlaneTrpcRouter } from "./base.js";
import { sandboxInstancesTrpcRouter } from "./routers/sandbox-instances.js";

export const dataPlaneTrpcRouter = createDataPlaneTrpcRouter({
  sandboxInstances: sandboxInstancesTrpcRouter,
});

export type DataPlaneTrpcRouter = typeof dataPlaneTrpcRouter;
