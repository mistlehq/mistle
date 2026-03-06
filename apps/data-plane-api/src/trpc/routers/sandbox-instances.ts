import { type StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import { createDataPlaneSandboxInstancesTrpcRouter } from "@mistle/data-plane-trpc/router";
import {
  SandboxInstanceStatuses,
  sandboxInstances,
  SandboxSnapshotArtifactKinds,
} from "@mistle/db/data-plane";
import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflows/data-plane";
import { and, eq, sql } from "drizzle-orm";
import { typeid } from "typeid-js";
import { z } from "zod";

import { createDataPlaneTrpcRouter } from "../base.js";
import { dataPlaneTrpcProcedure } from "../base.js";

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveSnapshotImageHandleFromArtifactRef(artifactRef: unknown): {
  imageId: string;
  kind: "snapshot";
  createdAt: string;
} {
  if (!isRecord(artifactRef)) {
    throw new Error("Sandbox snapshot artifact reference must be an object.");
  }

  const imageIdValue = artifactRef.imageId;
  if (typeof imageIdValue !== "string" || imageIdValue.trim().length === 0) {
    throw new Error("Sandbox snapshot artifact reference must include a non-empty imageId.");
  }

  const kindValue = artifactRef.kind;
  if (kindValue !== "snapshot") {
    throw new Error("Sandbox snapshot artifact reference kind must be 'snapshot'.");
  }

  const createdAtValue = artifactRef.createdAt;
  if (typeof createdAtValue !== "string" || createdAtValue.trim().length === 0) {
    throw new Error("Sandbox snapshot artifact reference must include a non-empty createdAt.");
  }

  return {
    imageId: imageIdValue,
    kind: "snapshot",
    createdAt: createdAtValue,
  };
}

function toISOStringTimestamp(timestamp: string): string {
  const parsedTimestamp = new Date(timestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    throw new Error("Expected a valid timestamp for sandbox snapshot metadata.");
  }

  return parsedTimestamp.toISOString();
}

function createStartSandboxIdempotencyKey(input: StartSandboxInstanceInput): string {
  return JSON.stringify({
    sandboxInstanceId: input.sandboxInstanceId ?? null,
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
  createGetLatestSnapshotProcedure: (schemas) =>
    dataPlaneTrpcProcedure
      .input(schemas.inputSchema)
      .output(schemas.outputSchema)
      .query(async ({ ctx, input }) => {
        const latestSnapshot = await ctx.resources.db.query.sandboxInstanceSnapshots.findFirst({
          columns: {
            id: true,
            sourceInstanceId: true,
            createdAt: true,
            artifactRef: true,
          },
          where: (table, { and, eq, isNull }) =>
            and(
              eq(table.organizationId, input.organizationId),
              eq(table.sourceInstanceId, input.sourceInstanceId),
              eq(table.artifactKind, SandboxSnapshotArtifactKinds.PROVIDER_IMAGE),
              isNull(table.deletedAt),
            ),
          orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.id)],
        });

        if (latestSnapshot === undefined) {
          return null;
        }

        return {
          snapshotId: latestSnapshot.id,
          sourceInstanceId: input.sourceInstanceId,
          createdAt: toISOStringTimestamp(latestSnapshot.createdAt),
          image: resolveSnapshotImageHandleFromArtifactRef(latestSnapshot.artifactRef),
        };
      }),
  createStartProcedure: (schemas) =>
    dataPlaneTrpcProcedure
      .input(schemas.inputSchema)
      .output(schemas.outputSchema)
      .mutation(async ({ ctx, input }) => {
        const sandboxInstanceId = input.sandboxInstanceId ?? createSandboxInstanceId();
        const workflowRunHandle = await ctx.resources.openWorkflow.runWorkflow(
          StartSandboxInstanceWorkflowSpec,
          {
            ...input,
            sandboxInstanceId,
          },
          {
            idempotencyKey: createStartSandboxIdempotencyKey(input),
          },
        );
        const resolvedSandboxInstanceId =
          input.sandboxInstanceId ??
          (await resolveWorkflowSandboxInstanceId({
            workflowDbPool: ctx.resources.workflowDbPool,
            workflowNamespaceId: ctx.config.workflow.namespaceId,
            workflowRunId: workflowRunHandle.workflowRun.id,
          }));

        await ctx.resources.db
          .insert(sandboxInstances)
          .values({
            id: resolvedSandboxInstanceId,
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

        if (input.sandboxInstanceId !== undefined) {
          await ctx.resources.db
            .update(sandboxInstances)
            .set({
              providerSandboxId: null,
              status: SandboxInstanceStatuses.STARTING,
              startedAt: null,
              stoppedAt: null,
              failedAt: null,
              failureCode: null,
              failureMessage: null,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(sandboxInstances.id, input.sandboxInstanceId),
                eq(sandboxInstances.organizationId, input.organizationId),
                eq(sandboxInstances.status, SandboxInstanceStatuses.STOPPED),
              ),
            );
        }

        return {
          status: "accepted",
          sandboxInstanceId: resolvedSandboxInstanceId,
          workflowRunId: workflowRunHandle.workflowRun.id,
        };
      }),
});
