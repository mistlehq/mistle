import {
  SandboxInstancePurposes,
  sandboxInstances,
  type DataPlaneDatabase,
  SandboxInstanceStatuses,
  type SandboxInstance,
} from "@mistle/db/data-plane";
import { BadRequestError } from "@mistle/http/errors.js";
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
  isSandboxResourceNotFoundError,
  SandboxInspectStates,
  type SandboxAdapter,
} from "@mistle/sandbox";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppRuntimeResources } from "../../../resources.js";
import type { DataPlaneApiGlobalConfig } from "../../../types.js";
import { resolveEffectiveSandboxInstanceStatus } from "../effective-sandbox-instance-status.js";
import type { ListSandboxInstancesInput } from "../list-sandbox-instances/schema.js";
import type { ListSandboxInstancesResponse } from "../schemas.js";

export const InvalidListSandboxInstancesInputErrorCode = "INVALID_LIST_INPUT";
export const InvalidPaginationCursorErrorCode = "INVALID_PAGINATION_CURSOR";

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
  | "title"
  | "sandboxProfileVersion"
  | "status"
  | "startedByKind"
  | "startedById"
  | "source"
  | "createdAt"
  | "updatedAt"
  | "failureCode"
  | "failureMessage"
  | "runtimeProvider"
  | "providerSandboxId"
>;

type ListSandboxInstancesContext = {
  db: DataPlaneDatabase;
  runtimeStateReader: AppRuntimeResources["runtimeStateReader"];
  sandboxAdapter: SandboxAdapter;
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
};

async function resolveListedSandboxRuntimeState(
  ctx: Pick<
    ListSandboxInstancesContext,
    "db" | "runtimeStateReader" | "sandboxAdapter" | "sandboxProvider"
  >,
  input: {
    sandboxInstanceId: string;
    persistedStatus: SandboxInstance["status"];
    runtimeProvider: SandboxInstance["runtimeProvider"];
    providerSandboxId: SandboxInstance["providerSandboxId"];
    failureCode: SandboxInstance["failureCode"];
    failureMessage: SandboxInstance["failureMessage"];
  },
): Promise<{
  status: ListSandboxInstancesResponse["items"][number]["status"];
  keepaliveActive: boolean;
}> {
  if (
    input.persistedStatus !== SandboxInstanceStatuses.STARTING &&
    input.persistedStatus !== SandboxInstanceStatuses.RUNNING
  ) {
    return {
      status: input.persistedStatus,
      keepaliveActive: false,
    };
  }

  const runtimeStateSnapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: input.sandboxInstanceId,
    nowMs: Date.now(),
  });

  const status = resolveEffectiveSandboxInstanceStatus({
    persistedStatus: input.persistedStatus,
    runtimeStateSnapshot,
  });

  if (input.persistedStatus === SandboxInstanceStatuses.STARTING || status === "running") {
    return {
      status,
      keepaliveActive: status === "running" && runtimeStateSnapshot.keepalive.active,
    };
  }

  if (input.runtimeProvider !== ctx.sandboxProvider) {
    throw new Error(
      `Sandbox instance '${input.sandboxInstanceId}' runtime provider '${input.runtimeProvider}' does not match configured provider '${ctx.sandboxProvider}'.`,
    );
  }

  if (input.providerSandboxId === null) {
    throw new Error(
      `Expected running sandbox instance '${input.sandboxInstanceId}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(ctx, input.providerSandboxId);
  if (inspection === null) {
    return {
      status,
      keepaliveActive: false,
    };
  }

  if (inspection.state === SandboxInspectStates.RUNNING) {
    return {
      status,
      keepaliveActive: false,
    };
  }

  await markRunningSandboxInstanceStopped(ctx, {
    sandboxInstanceId: input.sandboxInstanceId,
  });
  return {
    status: SandboxInstanceStatuses.STOPPED,
    keepaliveActive: false,
  };
}

async function markRunningSandboxInstanceStopped(
  ctx: Pick<ListSandboxInstancesContext, "db">,
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.STOPPED,
      stoppedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.RUNNING),
      ),
    )
    .returning({
      status: sandboxInstances.status,
    });

  if (updatedRows[0]?.status === SandboxInstanceStatuses.STOPPED) {
    return;
  }

  throw new Error("Failed to transition sandbox instance status from running to stopped.");
}

async function inspectSandboxInstanceOrNull(
  ctx: Pick<ListSandboxInstancesContext, "sandboxAdapter">,
  providerSandboxId: string,
) {
  try {
    return await ctx.sandboxAdapter.inspect({
      id: providerSandboxId,
    });
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    return null;
  }
}

function createInvalidCursorErrorMessage(input: {
  cursorName: string;
  reason: (typeof KeysetCursorDecodeErrorReasons)[keyof typeof KeysetCursorDecodeErrorReasons];
}): string {
  if (input.reason === KeysetCursorDecodeErrorReasons.INVALID_BASE64URL) {
    return `\`${input.cursorName}\` cursor is not valid base64url.`;
  }

  if (input.reason === KeysetCursorDecodeErrorReasons.INVALID_JSON) {
    return `\`${input.cursorName}\` cursor does not contain valid JSON.`;
  }

  return `\`${input.cursorName}\` cursor has an invalid shape.`;
}

export async function listSandboxInstances(
  ctx: ListSandboxInstancesContext,
  input: ListSandboxInstancesInput,
): Promise<ListSandboxInstancesResponse> {
  try {
    const response = await paginateKeyset<ListSandboxInstanceRow, SandboxInstancesCursor>({
      query: {
        after: input.after,
        before: input.before,
      },
      pageSize: input.limit ?? 20,
      decodeCursor: ({ encodedCursor, cursorName }) =>
        decodeKeysetCursorOrThrow({
          encodedCursor,
          cursorName,
          schema: SandboxInstancesCursorSchema,
          mapDecodeError: ({ cursorName: decodeCursorName, reason }) =>
            new BadRequestError(
              InvalidPaginationCursorErrorCode,
              createInvalidCursorErrorMessage({
                cursorName: decodeCursorName,
                reason,
              }),
            ),
        }),
      encodeCursor: encodeKeysetCursor,
      getCursor: (item) => ({
        createdAt: item.createdAt,
        id: item.id,
      }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) =>
        ctx.db.query.sandboxInstances.findMany({
          columns: {
            id: true,
            sandboxProfileId: true,
            title: true,
            sandboxProfileVersion: true,
            status: true,
            runtimeProvider: true,
            providerSandboxId: true,
            startedByKind: true,
            startedById: true,
            source: true,
            createdAt: true,
            updatedAt: true,
            failureCode: true,
            failureMessage: true,
          },
          where: (table, { and, eq, gt, lt, or }) => {
            const organizationScope = and(
              eq(table.organizationId, input.organizationId),
              eq(table.purpose, SandboxInstancePurposes.SESSION),
            );

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
        const [result] = await ctx.db
          .select({
            totalResults: sql<number>`count(*)::int`,
          })
          .from(sandboxInstances)
          .where(
            and(
              eq(sandboxInstances.organizationId, input.organizationId),
              eq(sandboxInstances.purpose, SandboxInstancePurposes.SESSION),
            ),
          );

        return result?.totalResults ?? 0;
      },
    });

    const items = await Promise.all(
      response.items.map(async (item) => {
        const runtimeState = await resolveListedSandboxRuntimeState(ctx, {
          sandboxInstanceId: item.id,
          persistedStatus: item.status,
          runtimeProvider: item.runtimeProvider,
          providerSandboxId: item.providerSandboxId,
          failureCode: item.failureCode,
          failureMessage: item.failureMessage,
        });

        return {
          id: item.id,
          sandboxProfileId: item.sandboxProfileId,
          title: item.title,
          sandboxProfileVersion: item.sandboxProfileVersion,
          status: runtimeState.status,
          keepaliveActive: runtimeState.keepaliveActive,
          startedBy: {
            kind: item.startedByKind,
            id: item.startedById,
          },
          source: item.source,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          failureCode: item.failureCode,
          failureMessage: item.failureMessage,
        };
      }),
    );

    return {
      totalResults: response.totalResults,
      items,
      nextPage: response.nextPage,
      previousPage: response.previousPage,
    };
  } catch (error) {
    if (
      error instanceof KeysetPaginationInputError &&
      error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
    ) {
      throw new BadRequestError(
        InvalidListSandboxInstancesInputErrorCode,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}
