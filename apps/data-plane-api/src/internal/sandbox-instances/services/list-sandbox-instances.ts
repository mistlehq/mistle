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
import { and, eq, gt, ilike, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
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

type StartedByFilterInput =
  | {
      startedByKind: SandboxInstance["startedByKind"];
      startedById: string;
    }
  | {
      startedByKind?: undefined;
      startedById?: undefined;
    };

type StartedByScopeFilterInput =
  | {
      startedByScope: "self" | "others";
      startedByUserId: string;
    }
  | {
      startedByScope?: undefined;
      startedByUserId?: undefined;
    };

type ListSandboxInstancesServiceInput = Omit<
  ListSandboxInstancesInput,
  "startedById" | "startedByKind" | "startedByScope" | "startedByUserId"
> &
  StartedByFilterInput &
  StartedByScopeFilterInput;

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

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function combineAnd(conditions: SQL[]): SQL {
  const expression = and(...conditions);
  if (expression === undefined) {
    throw new Error("At least one condition is required.");
  }

  return expression;
}

function combineOr(conditions: SQL[]): SQL {
  const expression = or(...conditions);
  if (expression === undefined) {
    throw new Error("At least one condition is required.");
  }

  return expression;
}

export async function listSandboxInstances(
  ctx: ListSandboxInstancesContext,
  input: ListSandboxInstancesServiceInput,
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
          where: (table) => {
            const filters: SQL[] = [
              eq(table.organizationId, input.organizationId),
              eq(table.purpose, SandboxInstancePurposes.SESSION),
            ];

            if (input.startedByKind !== undefined) {
              filters.push(eq(table.startedByKind, input.startedByKind));
              filters.push(eq(table.startedById, input.startedById));
            }

            if (input.startedByScope === "self") {
              filters.push(eq(table.startedByKind, "user"));
              filters.push(eq(table.startedById, input.startedByUserId));
            } else if (input.startedByScope === "others") {
              filters.push(eq(table.startedByKind, "user"));
              filters.push(ne(table.startedById, input.startedByUserId));
            }

            if (input.startedBySystemIds !== undefined) {
              filters.push(eq(table.startedByKind, "system"));
              filters.push(inArray(table.startedById, input.startedBySystemIds));
            }

            if (input.source === "dashboard") {
              filters.push(eq(table.source, "dashboard"));
            } else if (input.source === "trigger") {
              filters.push(inArray(table.source, ["webhook", "schedule"]));
            } else if (input.source === "webhook" || input.source === "schedule") {
              filters.push(eq(table.source, input.source));
            }

            const searchFilters: SQL[] = [];
            if (input.titleSearch !== undefined) {
              searchFilters.push(ilike(table.title, `%${escapeLikePattern(input.titleSearch)}%`));
            }
            if (input.matchingSandboxProfileIds !== undefined) {
              searchFilters.push(inArray(table.sandboxProfileId, input.matchingSandboxProfileIds));
            }
            if (input.matchingStartedByUserIds !== undefined) {
              searchFilters.push(
                combineAnd([
                  eq(table.startedByKind, "user"),
                  inArray(table.startedById, input.matchingStartedByUserIds),
                ]),
              );
            }
            if (input.matchingStartedBySystemIds !== undefined) {
              searchFilters.push(
                combineAnd([
                  eq(table.startedByKind, "system"),
                  inArray(table.startedById, input.matchingStartedBySystemIds),
                ]),
              );
            }
            if (searchFilters.length > 0) {
              filters.push(combineOr(searchFilters));
            }

            if (cursor === undefined) {
              return combineAnd(filters);
            }

            if (direction === KeysetPaginationDirections.FORWARD) {
              return combineAnd([
                ...filters,
                combineOr([
                  lt(table.createdAt, cursor.createdAt),
                  combineAnd([eq(table.createdAt, cursor.createdAt), lt(table.id, cursor.id)]),
                ]),
              ]);
            }

            return combineAnd([
              ...filters,
              combineOr([
                gt(table.createdAt, cursor.createdAt),
                combineAnd([eq(table.createdAt, cursor.createdAt), gt(table.id, cursor.id)]),
              ]),
            ]);
          },
          orderBy:
            direction === KeysetPaginationDirections.BACKWARD
              ? (table, { asc }) => [asc(table.createdAt), asc(table.id)]
              : (table, { desc }) => [desc(table.createdAt), desc(table.id)],
          limit: limitPlusOne,
        }),
      countTotalResults: async () => {
        const countFilters: SQL[] = [
          eq(sandboxInstances.organizationId, input.organizationId),
          eq(sandboxInstances.purpose, SandboxInstancePurposes.SESSION),
        ];

        if (input.startedByKind !== undefined) {
          countFilters.push(eq(sandboxInstances.startedByKind, input.startedByKind));
          countFilters.push(eq(sandboxInstances.startedById, input.startedById));
        }

        if (input.startedByScope === "self") {
          countFilters.push(eq(sandboxInstances.startedByKind, "user"));
          countFilters.push(eq(sandboxInstances.startedById, input.startedByUserId));
        } else if (input.startedByScope === "others") {
          countFilters.push(eq(sandboxInstances.startedByKind, "user"));
          countFilters.push(ne(sandboxInstances.startedById, input.startedByUserId));
        }

        if (input.startedBySystemIds !== undefined) {
          countFilters.push(eq(sandboxInstances.startedByKind, "system"));
          countFilters.push(inArray(sandboxInstances.startedById, input.startedBySystemIds));
        }

        if (input.source === "dashboard") {
          countFilters.push(eq(sandboxInstances.source, "dashboard"));
        } else if (input.source === "trigger") {
          countFilters.push(inArray(sandboxInstances.source, ["webhook", "schedule"]));
        } else if (input.source === "webhook" || input.source === "schedule") {
          countFilters.push(eq(sandboxInstances.source, input.source));
        }

        const searchFilters: SQL[] = [];
        if (input.titleSearch !== undefined) {
          searchFilters.push(
            ilike(sandboxInstances.title, `%${escapeLikePattern(input.titleSearch)}%`),
          );
        }
        if (input.matchingSandboxProfileIds !== undefined) {
          searchFilters.push(
            inArray(sandboxInstances.sandboxProfileId, input.matchingSandboxProfileIds),
          );
        }
        if (input.matchingStartedByUserIds !== undefined) {
          searchFilters.push(
            combineAnd([
              eq(sandboxInstances.startedByKind, "user"),
              inArray(sandboxInstances.startedById, input.matchingStartedByUserIds),
            ]),
          );
        }
        if (input.matchingStartedBySystemIds !== undefined) {
          searchFilters.push(
            combineAnd([
              eq(sandboxInstances.startedByKind, "system"),
              inArray(sandboxInstances.startedById, input.matchingStartedBySystemIds),
            ]),
          );
        }
        if (searchFilters.length > 0) {
          countFilters.push(combineOr(searchFilters));
        }

        const [result] = await ctx.db
          .select({
            totalResults: sql<number>`count(*)::int`,
          })
          .from(sandboxInstances)
          .where(combineAnd(countFilters));

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
