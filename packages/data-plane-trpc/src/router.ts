import {
  initTRPC,
  type AnyMutationProcedure,
  type AnyQueryProcedure,
  type AnyRouter,
} from "@trpc/server";

import {
  GetSandboxInstanceInputSchema,
  GetSandboxInstanceResponseSchema,
  type GetSandboxInstanceInput,
  type GetSandboxInstanceResponse,
  StartSandboxInstanceAcceptedResponseSchema,
  type StartSandboxInstanceAcceptedResponse,
  StartSandboxInstanceInputSchema,
  type StartSandboxInstanceInput,
} from "./contracts/index.js";

type GetSandboxProcedureSchemas = {
  inputSchema: typeof GetSandboxInstanceInputSchema;
  outputSchema: typeof GetSandboxInstanceResponseSchema;
};

type StartSandboxProcedureSchemas = {
  inputSchema: typeof StartSandboxInstanceInputSchema;
  outputSchema: typeof StartSandboxInstanceAcceptedResponseSchema;
};

export function createDataPlaneSandboxInstancesTrpcRouter<
  TGetProcedure extends AnyQueryProcedure,
  TStartProcedure extends AnyMutationProcedure,
  TSandboxInstancesRouter extends AnyRouter,
>(input: {
  createRouter: (routerInput: {
    get: TGetProcedure;
    start: TStartProcedure;
  }) => TSandboxInstancesRouter;
  createGetProcedure: (schemas: GetSandboxProcedureSchemas) => TGetProcedure;
  createStartProcedure: (schemas: StartSandboxProcedureSchemas) => TStartProcedure;
}): TSandboxInstancesRouter {
  return input.createRouter({
    get: input.createGetProcedure({
      inputSchema: GetSandboxInstanceInputSchema,
      outputSchema: GetSandboxInstanceResponseSchema,
    }),
    start: input.createStartProcedure({
      inputSchema: StartSandboxInstanceInputSchema,
      outputSchema: StartSandboxInstanceAcceptedResponseSchema,
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

function createTypeOnlyStartSandboxInstanceAcceptedResponse(
  _input: StartSandboxInstanceInput,
): Promise<StartSandboxInstanceAcceptedResponse> {
  throw new Error("Data plane tRPC contract router is type-only and should not execute.");
}

function createTypeOnlyGetSandboxInstanceResponse(
  _input: GetSandboxInstanceInput,
): Promise<GetSandboxInstanceResponse> {
  throw new Error("Data plane tRPC contract router is type-only and should not execute.");
}

const sandboxInstancesTrpcRouterContract = createDataPlaneSandboxInstancesTrpcRouter({
  createRouter: t.router,
  createGetProcedure: (schemas) =>
    t.procedure
      .input(schemas.inputSchema)
      .output(schemas.outputSchema)
      .query(({ input }) => {
        return createTypeOnlyGetSandboxInstanceResponse(input);
      }),
  createStartProcedure: (schemas) =>
    t.procedure
      .input(schemas.inputSchema)
      .output(schemas.outputSchema)
      .mutation(({ input }) => {
        return createTypeOnlyStartSandboxInstanceAcceptedResponse(input);
      }),
});

export const dataPlaneTrpcRouterContract = createDataPlaneTrpcRouter({
  createRouter: t.router,
  sandboxInstances: sandboxInstancesTrpcRouterContract,
});

export type DataPlaneSandboxInstancesTrpcRouter = typeof sandboxInstancesTrpcRouterContract;
export type DataPlaneTrpcRouter = typeof dataPlaneTrpcRouterContract;
