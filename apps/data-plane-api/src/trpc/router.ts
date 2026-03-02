import type { DataPlaneTrpcRouter as DataPlaneTrpcRouterContract } from "@mistle/data-plane-trpc/router";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import { createDataPlaneTrpcRouter } from "./base.js";
import { sandboxInstancesTrpcRouter } from "./routers/sandbox-instances.js";

export const dataPlaneTrpcRouter = createDataPlaneTrpcRouter({
  sandboxInstances: sandboxInstancesTrpcRouter,
});

export type DataPlaneTrpcRouter = typeof dataPlaneTrpcRouter;

type RouterInputsImplementContract =
  inferRouterInputs<DataPlaneTrpcRouter> extends inferRouterInputs<DataPlaneTrpcRouterContract>
    ? true
    : never;
const routerInputsImplementContract: RouterInputsImplementContract = true;
void routerInputsImplementContract;

type ContractInputsImplementRouter =
  inferRouterInputs<DataPlaneTrpcRouterContract> extends inferRouterInputs<DataPlaneTrpcRouter>
    ? true
    : never;
const contractInputsImplementRouter: ContractInputsImplementRouter = true;
void contractInputsImplementRouter;

type RouterOutputsImplementContract =
  inferRouterOutputs<DataPlaneTrpcRouter> extends inferRouterOutputs<DataPlaneTrpcRouterContract>
    ? true
    : never;
const routerOutputsImplementContract: RouterOutputsImplementContract = true;
void routerOutputsImplementContract;

type ContractOutputsImplementRouter =
  inferRouterOutputs<DataPlaneTrpcRouterContract> extends inferRouterOutputs<DataPlaneTrpcRouter>
    ? true
    : never;
const contractOutputsImplementRouter: ContractOutputsImplementRouter = true;
void contractOutputsImplementRouter;
