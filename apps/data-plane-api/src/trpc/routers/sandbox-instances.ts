import { type StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import { createDataPlaneSandboxInstancesTrpcRouter } from "@mistle/data-plane-trpc/router";
import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflows/data-plane";
import { typeid } from "typeid-js";
import { z } from "zod";

import { createDataPlaneTrpcRouter } from "../base.js";
import { dataPlaneTrpcProcedure } from "../base.js";

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

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

function createSandboxInstanceId(): string {
  return typeid("sbi").toString();
}

async function resolveWorkflowSandboxInstanceId(input: {
  workflowDbPool: {
    query: (
      text: string,
      values: ReadonlyArray<string>,
    ) => Promise<{ rows: Array<{ input: unknown }> }>;
  };
  workflowNamespaceId: string;
  workflowRunId: string;
}): Promise<string> {
  const result = await input.workflowDbPool.query(
    `
      select input
      from data_plane_openworkflow.workflow_runs
      where namespace_id = $1 and id = $2
      limit 1
    `,
    [input.workflowNamespaceId, input.workflowRunId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(
      `Workflow run '${input.workflowRunId}' was not found in the workflow database.`,
    );
  }

  const parsedInput = WorkflowRunInputSchema.safeParse(row.input);
  if (!parsedInput.success) {
    throw new Error(`Workflow run '${input.workflowRunId}' has invalid stored input.`);
  }

  return parsedInput.data.sandboxInstanceId;
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
            failureCode: true,
            failureMessage: true,
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
          failureCode: sandboxInstance.failureCode,
          failureMessage: sandboxInstance.failureMessage,
        };
      }),
  createStartProcedure: (schemas) =>
    dataPlaneTrpcProcedure
      .input(schemas.inputSchema)
      .output(schemas.outputSchema)
      .mutation(async ({ ctx, input }) => {
        const workflowRunHandle = await ctx.resources.openWorkflow.runWorkflow(
          StartSandboxInstanceWorkflowSpec,
          {
            ...input,
            sandboxInstanceId: createSandboxInstanceId(),
          },
          {
            idempotencyKey: createStartSandboxIdempotencyKey(input),
          },
        );

        const sandboxInstanceId = await resolveWorkflowSandboxInstanceId({
          workflowDbPool: ctx.resources.workflowDbPool,
          workflowNamespaceId: ctx.config.workflow.namespaceId,
          workflowRunId: workflowRunHandle.workflowRun.id,
        });

        await ctx.resources.db
          .insert(sandboxInstances)
          .values({
            id: sandboxInstanceId,
            organizationId: input.organizationId,
            sandboxProfileId: input.sandboxProfileId,
            sandboxProfileVersion: input.sandboxProfileVersion,
            provider: ctx.sandboxProvider,
            providerSandboxId: null,
            status: SandboxInstanceStatuses.STARTING,
            startedByKind: input.startedBy.kind,
            startedById: input.startedBy.id,
            source: input.source,
          })
          .onConflictDoNothing({
            target: [sandboxInstances.id],
          });

        return {
          status: "accepted",
          sandboxInstanceId,
          workflowRunId: workflowRunHandle.workflowRun.id,
        };
      }),
});
