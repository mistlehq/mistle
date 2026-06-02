import { type DataPlaneDatabase, type DataPlaneTables } from "@mistle/db/data-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { DeleteSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { AppRuntimeResources } from "../../../resources.js";
import type { DeleteSandboxInstanceResponse } from "../delete-sandbox-instance/schema.js";

type DeleteSandboxInstanceContext = {
  db: DataPlaneDatabase;
  openWorkflow: Pick<AppRuntimeResources["openWorkflow"], "runWorkflow">;
  tables: Pick<DataPlaneTables, "sandboxInstances">;
};

type DeleteSandboxInstanceInput = {
  organizationId: string;
  sandboxInstanceId: string;
};

export const DeleteSandboxInstanceNotFoundErrorCode = "NOT_FOUND";

function createDeleteSandboxDestroyIdempotencyKey(input: DeleteSandboxInstanceInput): string {
  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "delete_sandbox_destroy",
    organizationId: input.organizationId,
  });
}

export async function deleteSandboxInstance(
  ctx: DeleteSandboxInstanceContext,
  input: DeleteSandboxInstanceInput,
): Promise<DeleteSandboxInstanceResponse> {
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      deletedAt: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sandboxInstanceId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (sandboxInstance === undefined) {
    throw new NotFoundError(
      DeleteSandboxInstanceNotFoundErrorCode,
      `Sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }

  if (sandboxInstance.deletedAt !== null) {
    return {
      status: "already_deleted",
      sandboxInstanceId: input.sandboxInstanceId,
      workflowRunId: null,
    };
  }

  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    DeleteSandboxInstanceWorkflowSpec,
    {
      sandboxInstanceId: input.sandboxInstanceId,
    },
    {
      idempotencyKey: createDeleteSandboxDestroyIdempotencyKey(input),
    },
  );

  const updatedRows = await ctx.db
    .update(ctx.tables.sandboxInstances)
    .set({
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ctx.tables.sandboxInstances.id, input.sandboxInstanceId),
        eq(ctx.tables.sandboxInstances.organizationId, input.organizationId),
        isNull(ctx.tables.sandboxInstances.deletedAt),
      ),
    )
    .returning({
      id: ctx.tables.sandboxInstances.id,
    });

  if (updatedRows[0] === undefined) {
    return {
      status: "already_deleted",
      sandboxInstanceId: input.sandboxInstanceId,
      workflowRunId: null,
    };
  }

  return {
    status: "deleted",
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: workflowRunHandle?.workflowRun.id ?? null,
  };
}
