import {
  SandboxInstancePurposes,
  type DataPlaneDatabase,
  type DataPlaneTables,
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
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

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
>;

type ListSandboxInstancesContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstances">;
};

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
    const { sandboxInstances } = ctx.tables;

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

    const items = response.items.map((item) => {
      return {
        id: item.id,
        sandboxProfileId: item.sandboxProfileId,
        title: item.title,
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
      };
    });

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
