import type { SandboxProfile } from "@mistle/db/control-plane";
import type { KeysetPaginatedResult } from "@mistle/http/pagination";

import { sandboxProfiles } from "@mistle/db/control-plane";
import {
  decodeKeysetCursorOrThrow,
  encodeKeysetCursor,
  KeysetCursorDecodeErrorReasons,
  parseKeysetPageSize,
  KeysetPaginationDirections,
  KeysetPaginationInputError,
  KeysetPaginationInputErrorReasons,
  paginateKeyset,
} from "@mistle/http/pagination";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

import { SandboxProfilesBadRequestCodes, SandboxProfilesBadRequestError } from "./errors.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const PageSizeOptions = {
  defaultLimit: DEFAULT_PAGE_SIZE,
  maxLimit: MAX_PAGE_SIZE,
} as const;

const CursorSchema = z
  .object({
    createdAt: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

export type ListProfilesInput = {
  organizationId: string;
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
};

export async function listProfiles(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: ListProfilesInput,
): Promise<KeysetPaginatedResult<SandboxProfile>> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PageSizeOptions);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new SandboxProfilesBadRequestError(
        SandboxProfilesBadRequestCodes.INVALID_LIST_PROFILES_INPUT,
        `\`limit\` must be an integer between 1 and ${String(MAX_PAGE_SIZE)}.`,
      );
    }

    throw error;
  }

  try {
    return await paginateKeyset({
      query: {
        after: input.after,
        before: input.before,
      },
      pageSize,
      decodeCursor: ({ encodedCursor, cursorName }) =>
        decodeKeysetCursorOrThrow({
          encodedCursor,
          cursorName,
          schema: CursorSchema,
          mapDecodeError: ({ cursorName: decodeCursorName, reason }) => {
            const reasonToMessage = {
              [KeysetCursorDecodeErrorReasons.INVALID_BASE64URL]: `\`${decodeCursorName}\` cursor is not valid base64url.`,
              [KeysetCursorDecodeErrorReasons.INVALID_JSON]: `\`${decodeCursorName}\` cursor does not contain valid JSON.`,
              [KeysetCursorDecodeErrorReasons.INVALID_SHAPE]: `\`${decodeCursorName}\` cursor has an invalid shape.`,
            } as const;

            return new SandboxProfilesBadRequestError(
              SandboxProfilesBadRequestCodes.INVALID_PAGINATION_CURSOR,
              reasonToMessage[reason],
            );
          },
        }),
      encodeCursor: encodeKeysetCursor,
      getCursor: (profile) => ({
        createdAt: profile.createdAt,
        id: profile.id,
      }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) =>
        db.query.sandboxProfiles.findMany({
          where: (table, { and, eq, gt, lt, or }) => {
            const organizationScope = eq(table.organizationId, input.organizationId);

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
        const [result] = await db
          .select({
            totalResults: sql<number>`count(*)::int`,
          })
          .from(sandboxProfiles)
          .where(eq(sandboxProfiles.organizationId, input.organizationId));

        return result?.totalResults ?? 0;
      },
    });
  } catch (error) {
    if (
      error instanceof KeysetPaginationInputError &&
      error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
    ) {
      throw new SandboxProfilesBadRequestError(
        SandboxProfilesBadRequestCodes.INVALID_LIST_PROFILES_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}
