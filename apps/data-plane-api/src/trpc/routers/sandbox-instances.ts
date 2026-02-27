import {
  StartSandboxInstanceAcceptedResponseSchema,
  StartSandboxInstanceInputSchema,
} from "@mistle/data-plane-trpc/contracts";
import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflows/data-plane";

import { createDataPlaneTrpcRouter } from "../base.js";
import { dataPlaneTrpcProcedure } from "../base.js";

export const sandboxInstancesTrpcRouter = createDataPlaneTrpcRouter({
  start: dataPlaneTrpcProcedure
    .input(StartSandboxInstanceInputSchema)
    .output(StartSandboxInstanceAcceptedResponseSchema)
    .mutation(async ({ ctx, input }) => {
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
