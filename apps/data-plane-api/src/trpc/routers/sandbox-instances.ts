import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-trpc/constants";
import {
  StartSandboxInstanceAcceptedResponseSchema,
  StartSandboxInstanceInputSchema,
} from "@mistle/data-plane-trpc/contracts";
import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflows/data-plane";
import { TRPCError } from "@trpc/server";

import { createDataPlaneTrpcRouter } from "../base.js";
import { dataPlaneTrpcProcedure } from "../base.js";

export const sandboxInstancesTrpcRouter = createDataPlaneTrpcRouter({
  start: dataPlaneTrpcProcedure
    .input(StartSandboxInstanceInputSchema)
    .output(StartSandboxInstanceAcceptedResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const providedServiceToken = ctx.requestHeaders.get(DATA_PLANE_INTERNAL_AUTH_HEADER);

      if (providedServiceToken === null || providedServiceToken !== ctx.internalAuthServiceToken) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Internal service authentication failed.",
        });
      }

      const workflowRunHandle = await ctx.resources.openWorkflow.runWorkflow(
        StartSandboxInstanceWorkflowSpec,
        input,
      );

      return {
        status: "accepted",
        workflowRunId: workflowRunHandle.workflowRun.id,
      };
    }),
});
