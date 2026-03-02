import { initTRPC } from "@trpc/server";

import {
  StartSandboxInstanceCompletedResponseSchema,
  StartSandboxInstanceInputSchema,
} from "./contracts/index.js";

const t = initTRPC.create();

const typeOnlyStartSandboxInstanceProcedure = t.procedure
  .input(StartSandboxInstanceInputSchema)
  .output(StartSandboxInstanceCompletedResponseSchema)
  .mutation(() => {
    throw new Error("Data plane tRPC contract router is type-only and should not execute.");
  });

export const dataPlaneTrpcRouterContract = t.router({
  sandboxInstances: t.router({
    start: typeOnlyStartSandboxInstanceProcedure,
  }),
});

export type DataPlaneTrpcRouter = typeof dataPlaneTrpcRouterContract;
