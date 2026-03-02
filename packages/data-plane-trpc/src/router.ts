import { initTRPC, type AnyMutationProcedure, type AnyRouter } from "@trpc/server";

import {
  StartSandboxInstanceCompletedResponseSchema,
  type StartSandboxInstanceCompletedResponse,
  StartSandboxInstanceInputSchema,
  type StartSandboxInstanceInput,
} from "./contracts/index.js";

type StartSandboxProcedureSchemas = {
  inputSchema: typeof StartSandboxInstanceInputSchema;
  outputSchema: typeof StartSandboxInstanceCompletedResponseSchema;
};

export function createDataPlaneSandboxInstancesTrpcRouter<
  TStartProcedure extends AnyMutationProcedure,
  TSandboxInstancesRouter extends AnyRouter,
>(input: {
  createRouter: (routerInput: { start: TStartProcedure }) => TSandboxInstancesRouter;
  createStartProcedure: (schemas: StartSandboxProcedureSchemas) => TStartProcedure;
}): TSandboxInstancesRouter {
  return input.createRouter({
    start: input.createStartProcedure({
      inputSchema: StartSandboxInstanceInputSchema,
      outputSchema: StartSandboxInstanceCompletedResponseSchema,
    }),
  });
}

export function createDataPlaneTrpcRouter<
  TRouter extends AnyRouter,
  TSandboxInstancesRouter extends AnyRouter,
>(input: {
  createRouter: (routerInput: { sandboxInstances: TSandboxInstancesRouter }) => TRouter;
  sandboxInstances: TSandboxInstancesRouter;
}): TRouter {
  return input.createRouter({
    sandboxInstances: input.sandboxInstances,
  });
}

const t = initTRPC.create();

function createTypeOnlyStartSandboxInstanceCompletedResponse(
  _input: StartSandboxInstanceInput,
): Promise<StartSandboxInstanceCompletedResponse> {
  throw new Error("Data plane tRPC contract router is type-only and should not execute.");
}

const sandboxInstancesTrpcRouterContract = createDataPlaneSandboxInstancesTrpcRouter({
  createRouter: t.router,
  createStartProcedure: (schemas) =>
    t.procedure
      .input(schemas.inputSchema)
      .output(schemas.outputSchema)
      .mutation(({ input }) => {
        return createTypeOnlyStartSandboxInstanceCompletedResponse(input);
      }),
});

export const dataPlaneTrpcRouterContract = createDataPlaneTrpcRouter({
  createRouter: t.router,
  sandboxInstances: sandboxInstancesTrpcRouterContract,
});

export type DataPlaneSandboxInstancesTrpcRouter = typeof sandboxInstancesTrpcRouterContract;
export type DataPlaneTrpcRouter = typeof dataPlaneTrpcRouterContract;
