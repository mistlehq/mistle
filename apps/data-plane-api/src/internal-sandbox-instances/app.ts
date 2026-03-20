import { randomUUID } from "node:crypto";

import { OpenAPIHono, z } from "@hono/zod-openapi";
import {
  SandboxInstanceStatuses,
  type SandboxInstance,
  sandboxInstances,
} from "@mistle/db/data-plane";
import {
  decodeKeysetCursorOrThrow,
  encodeKeysetCursor,
  KeysetCursorDecodeErrorReasons,
  KeysetPaginationDirections,
  KeysetPaginationInputError,
  KeysetPaginationInputErrorReasons,
  paginateKeyset,
} from "@mistle/http/pagination";
import {
  ResumeSandboxInstanceWorkflowSpec,
  StartSandboxInstanceWorkflowSpec,
  StopSandboxInstanceWorkflowSpec,
} from "@mistle/workflow-registry/data-plane";
import { sql } from "drizzle-orm";
import { typeid } from "typeid-js";

import { createRequireInternalAuthMiddleware } from "../middleware/require-internal-auth.js";
import { DataPlaneOpenWorkflowSchema } from "../openworkflow/index.js";
import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import {
  DATA_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH,
} from "./constants.js";
import {
  GetSandboxInstanceResponseSchema,
  internalGetSandboxInstanceRoute,
  internalListSandboxInstancesRoute,
  internalResumeSandboxInstanceRoute,
  internalStartSandboxInstanceRoute,
  internalStopSandboxInstanceRoute,
  InternalSandboxInstancesErrorResponseSchema,
  ListSandboxInstancesResponseSchema,
  ResumeSandboxInstanceAcceptedResponseSchema,
  ResumeSandboxInstanceInputValidationSchema,
  StopSandboxInstanceAcceptedResponseSchema,
  StopSandboxInstanceInputValidationSchema,
  StartSandboxInstanceAcceptedResponseSchema,
  StartSandboxInstanceInputValidationSchema,
} from "./contracts.js";

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

const SandboxInstancesCursorSchema = z
  .object({
    createdAt: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

type SandboxInstancesCursor = z.infer<typeof SandboxInstancesCursorSchema>;

type ListSandboxInstanceRow = Pick<
  SandboxInstance,
  | "id"
  | "sandboxProfileId"
  | "sandboxProfileVersion"
  | "status"
  | "startedByKind"
  | "startedById"
  | "source"
  | "createdAt"
  | "updatedAt"
  | "failureCode"
  | "failureMessage"
>;

const InternalSandboxInstancesErrorCodes = {
  INVALID_LIST_INPUT: "INVALID_LIST_INPUT",
  INVALID_PAGINATION_CURSOR: "INVALID_PAGINATION_CURSOR",
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

class InternalSandboxInstancesBadRequestError extends Error {
  code:
    | (typeof InternalSandboxInstancesErrorCodes)["INVALID_LIST_INPUT"]
    | (typeof InternalSandboxInstancesErrorCodes)["INVALID_PAGINATION_CURSOR"];

  constructor(
    code:
      | (typeof InternalSandboxInstancesErrorCodes)["INVALID_LIST_INPUT"]
      | (typeof InternalSandboxInstancesErrorCodes)["INVALID_PAGINATION_CURSOR"],
    message: string,
  ) {
    super(message);
    this.name = "InternalSandboxInstancesBadRequestError";
    this.code = code;
  }
}

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

function createResumeSandboxIdempotencyKey(
  input: z.infer<typeof ResumeSandboxInstanceInputValidationSchema>,
): string {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  return JSON.stringify({
    version: 1,
    organizationId: input.organizationId,
    sandboxInstanceId: input.instanceId,
    action: "resume",
    idempotencyKey,
  });
}

function createStopSandboxIdempotencyKey(
  input: z.infer<typeof StopSandboxInstanceInputValidationSchema>,
): string {
  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "stop",
    stopReason: input.stopReason,
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    idempotencyKey: input.idempotencyKey,
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
        runtimeProvider: ctx.get("sandboxProvider"),
        providerRuntimeId: null,
        instanceVolumeProvider: null,
        instanceVolumeId: null,
        instanceVolumeMode: null,
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

  routes.openapi(internalResumeSandboxInstanceRoute, async (ctx) => {
    const body = ctx.req.valid("json");
    const workflowRunHandle = await ctx.get("resources").openWorkflow.runWorkflow(
      ResumeSandboxInstanceWorkflowSpec,
      {
        sandboxInstanceId: body.instanceId,
      },
      {
        idempotencyKey: createResumeSandboxIdempotencyKey(body),
      },
    );

    const responseBody: z.infer<typeof ResumeSandboxInstanceAcceptedResponseSchema> = {
      status: "accepted",
      sandboxInstanceId: body.instanceId,
      workflowRunId: workflowRunHandle.workflowRun.id,
    };

    return ctx.json(responseBody, 200);
  });

  routes.openapi(internalStopSandboxInstanceRoute, async (ctx) => {
    const body = ctx.req.valid("json");
    const workflowRunHandle = await ctx.get("resources").openWorkflow.runWorkflow(
      StopSandboxInstanceWorkflowSpec,
      {
        sandboxInstanceId: body.sandboxInstanceId,
        stopReason: body.stopReason,
        expectedOwnerLeaseId: body.expectedOwnerLeaseId,
      },
      {
        idempotencyKey: createStopSandboxIdempotencyKey(body),
      },
    );

    const responseBody: z.infer<typeof StopSandboxInstanceAcceptedResponseSchema> = {
      status: "accepted",
      sandboxInstanceId: body.sandboxInstanceId,
      workflowRunId: workflowRunHandle.workflowRun.id,
    };

    return ctx.json(responseBody, 200);
  });

  routes.openapi(internalListSandboxInstancesRoute, async (ctx) => {
    try {
      const body = ctx.req.valid("json");
      const responseBody = await paginateKeyset<ListSandboxInstanceRow, SandboxInstancesCursor>({
        query: {
          after: body.after,
          before: body.before,
        },
        pageSize: body.limit ?? 20,
        decodeCursor: ({ encodedCursor, cursorName }) =>
          decodeKeysetCursorOrThrow({
            encodedCursor,
            cursorName,
            schema: SandboxInstancesCursorSchema,
            mapDecodeError: ({ cursorName: decodeCursorName, reason }) => {
              const reasonToMessage = {
                [KeysetCursorDecodeErrorReasons.INVALID_BASE64URL]: `\`${decodeCursorName}\` cursor is not valid base64url.`,
                [KeysetCursorDecodeErrorReasons.INVALID_JSON]: `\`${decodeCursorName}\` cursor does not contain valid JSON.`,
                [KeysetCursorDecodeErrorReasons.INVALID_SHAPE]: `\`${decodeCursorName}\` cursor has an invalid shape.`,
              } as const;

              return new InternalSandboxInstancesBadRequestError(
                InternalSandboxInstancesErrorCodes.INVALID_PAGINATION_CURSOR,
                reasonToMessage[reason],
              );
            },
          }),
        encodeCursor: encodeKeysetCursor,
        getCursor: (item) => ({
          createdAt: item.createdAt,
          id: item.id,
        }),
        fetchPage: async ({ direction, cursor, limitPlusOne }) =>
          ctx.get("resources").db.query.sandboxInstances.findMany({
            columns: {
              id: true,
              sandboxProfileId: true,
              sandboxProfileVersion: true,
              status: true,
              startedByKind: true,
              startedById: true,
              source: true,
              createdAt: true,
              updatedAt: true,
              failureCode: true,
              failureMessage: true,
            },
            where: (table, { and, eq, gt, lt, or }) => {
              const organizationScope = eq(table.organizationId, body.organizationId);

              if (cursor === undefined) {
                return organizationScope;
              }

              if (direction === KeysetPaginationDirections.FORWARD) {
                return and(
                  organizationScope,
                  or(
                    lt(table.createdAt, cursor.createdAt),
                    and(eq(table.createdAt, cursor.createdAt), lt(table.id, cursor.id)),
                  ),
                );
              }

              return and(
                organizationScope,
                or(
                  gt(table.createdAt, cursor.createdAt),
                  and(eq(table.createdAt, cursor.createdAt), gt(table.id, cursor.id)),
                ),
              );
            },
            orderBy:
              direction === KeysetPaginationDirections.BACKWARD
                ? (table, { asc }) => [asc(table.createdAt), asc(table.id)]
                : (table, { desc }) => [desc(table.createdAt), desc(table.id)],
            limit: limitPlusOne,
          }),
        countTotalResults: async () => {
          const [result] = await ctx
            .get("resources")
            .db.select({
              totalResults: sql<number>`count(*)::int`,
            })
            .from(sandboxInstances)
            .where(sql`${sandboxInstances.organizationId} = ${body.organizationId}`);

          return result?.totalResults ?? 0;
        },
      });

      const serializedResponse: z.infer<typeof ListSandboxInstancesResponseSchema> = {
        totalResults: responseBody.totalResults,
        items: responseBody.items.map((item) => ({
          id: item.id,
          sandboxProfileId: item.sandboxProfileId,
          sandboxProfileVersion: item.sandboxProfileVersion,
          status: item.status,
          startedBy: {
            kind: item.startedByKind,
            id: item.startedById,
          },
          source: item.source,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          failureCode: item.failureCode,
          failureMessage: item.failureMessage,
        })),
        nextPage: responseBody.nextPage,
        previousPage: responseBody.previousPage,
      };

      return ctx.json(serializedResponse, 200);
    } catch (error) {
      return handleListSandboxInstancesError(ctx, error);
    }
  });

  return {
    basePath: INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH,
    routes,
  };
}

export { InternalSandboxInstancesErrorResponseSchema };

function handleListSandboxInstancesError(ctx: AppContext, error: unknown) {
  if (error instanceof InternalSandboxInstancesBadRequestError) {
    const responseBody: z.infer<typeof InternalSandboxInstancesErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  if (
    error instanceof KeysetPaginationInputError &&
    error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
  ) {
    const responseBody: z.infer<typeof InternalSandboxInstancesErrorResponseSchema> = {
      code: InternalSandboxInstancesErrorCodes.INVALID_LIST_INPUT,
      message: "Only one of `after` or `before` can be provided.",
    };

    return ctx.json(responseBody, 400);
  }

  throw error;
}
