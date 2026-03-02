import { type StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import { createDataPlaneSandboxInstancesTrpcRouter } from "@mistle/data-plane-trpc/router";
import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflows/data-plane";

import { createDataPlaneTrpcRouter } from "../base.js";
import { dataPlaneTrpcProcedure } from "../base.js";

const START_SANDBOX_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

function createStartSandboxIdempotencyKey(input: StartSandboxInstanceInput): string {
  return JSON.stringify({
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    startedBy: {
      kind: input.startedBy.kind,
      id: input.startedBy.id,
    },
    source: input.source,
    image: input.image,
    runtimePlan: input.runtimePlan,
  });
}

export const sandboxInstancesTrpcRouter = createDataPlaneSandboxInstancesTrpcRouter({
  createRouter: createDataPlaneTrpcRouter,
  createGetProcedure: (schemas) =>
    dataPlaneTrpcProcedure
      .input(schemas.inputSchema)
      .output(schemas.outputSchema)
      .query(async ({ ctx, input }) => {
        const sandboxInstance = await ctx.resources.db.query.sandboxInstances.findFirst({
          columns: {
            id: true,
            status: true,
          },
          where: (table, { and, eq }) =>
            and(eq(table.id, input.instanceId), eq(table.organizationId, input.organizationId)),
        });

        if (sandboxInstance === undefined) {
          return null;
        }

        return {
          id: sandboxInstance.id,
          status: sandboxInstance.status,
        };
      }),
  createStartProcedure: (schemas) =>
    dataPlaneTrpcProcedure
      .input(schemas.inputSchema)
      .output(schemas.outputSchema)
      .mutation(async ({ ctx, input }) => {
        const workflowRunHandle = await ctx.resources.openWorkflow.runWorkflow(
          StartSandboxInstanceWorkflowSpec,
          input,
          {
            idempotencyKey: createStartSandboxIdempotencyKey(input),
          },
        );
        const workflowResult = await workflowRunHandle.result({
          timeoutMs: START_SANDBOX_WAIT_TIMEOUT_MS,
        });

        return {
          status: "completed",
          sandboxInstanceId: workflowResult.sandboxInstanceId,
          providerSandboxId: workflowResult.providerSandboxId,
          workflowRunId: workflowRunHandle.workflowRun.id,
        };
      }),
});
