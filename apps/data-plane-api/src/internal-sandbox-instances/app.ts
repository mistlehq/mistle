import { randomUUID } from "node:crypto";

import { OpenAPIHono, z } from "@hono/zod-openapi";
import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";

import { createRequireInternalAuthMiddleware } from "../middleware/require-internal-auth.js";
import { DataPlaneOpenWorkflowSchema } from "../openworkflow/index.js";
import type { AppContextBindings, AppRoutes } from "../types.js";
import {
  DATA_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH,
} from "./constants.js";
import {
  GetSandboxInstanceResponseSchema,
  internalGetSandboxInstanceRoute,
  internalStartSandboxInstanceRoute,
  InternalSandboxInstancesErrorResponseSchema,
  StartSandboxInstanceAcceptedResponseSchema,
  StartSandboxInstanceInputValidationSchema,
} from "./contracts.js";

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

const InternalSandboxInstancesErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

function createStartSandboxIdempotencyKey(
  input: z.infer<typeof StartSandboxInstanceInputValidationSchema>,
): string {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  return JSON.stringify({
    version: 1,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    source: input.source,
    idempotencyKey,
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
      from ${DataPlaneOpenWorkflowSchema}.workflow_runs
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

export function createInternalSandboxInstancesApp(): AppRoutes<
  typeof INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: DATA_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalSandboxInstancesErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(internalStartSandboxInstanceRoute, async (ctx) => {
    const body = ctx.req.valid("json");
    const workflowRunHandle = await ctx.get("resources").openWorkflow.runWorkflow(
      StartSandboxInstanceWorkflowSpec,
      {
        ...body,
        sandboxInstanceId: createSandboxInstanceId(),
      },
      {
        idempotencyKey: createStartSandboxIdempotencyKey(body),
      },
    );

    const sandboxInstanceId = await resolveWorkflowSandboxInstanceId({
      workflowDbPool: ctx.get("resources").workflowDbPool,
      workflowNamespaceId: ctx.get("config").workflow.namespaceId,
      workflowRunId: workflowRunHandle.workflowRun.id,
    });

    await ctx
      .get("resources")
      .db.insert(sandboxInstances)
      .values({
        id: sandboxInstanceId,
        organizationId: body.organizationId,
        sandboxProfileId: body.sandboxProfileId,
        sandboxProfileVersion: body.sandboxProfileVersion,
        provider: ctx.get("sandboxProvider"),
        providerSandboxId: null,
        status: SandboxInstanceStatuses.STARTING,
        startedByKind: body.startedBy.kind,
        startedById: body.startedBy.id,
        source: body.source,
      })
      .onConflictDoNothing({
        target: [sandboxInstances.id],
      });

    const responseBody: z.infer<typeof StartSandboxInstanceAcceptedResponseSchema> = {
      status: "accepted",
      sandboxInstanceId,
      workflowRunId: workflowRunHandle.workflowRun.id,
    };

    return ctx.json(responseBody, 200);
  });

  routes.openapi(internalGetSandboxInstanceRoute, async (ctx) => {
    const body = ctx.req.valid("json");
    const sandboxInstance = await ctx.get("resources").db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        status: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.id, body.instanceId), eq(table.organizationId, body.organizationId)),
    });

    const responseBody: z.infer<typeof GetSandboxInstanceResponseSchema> =
      sandboxInstance === undefined
        ? null
        : {
            id: sandboxInstance.id,
            status: sandboxInstance.status,
            failureCode: sandboxInstance.failureCode,
            failureMessage: sandboxInstance.failureMessage,
          };

    return ctx.json(responseBody, 200);
  });

  return {
    basePath: INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH,
    routes,
  };
}

export { InternalSandboxInstancesErrorResponseSchema };
