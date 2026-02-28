import { integrationTargets, type IntegrationTarget } from "@mistle/db/control-plane";
import type { KeysetPaginatedResult } from "@mistle/http/pagination";
import {
  decodeKeysetCursorOrThrow,
  encodeKeysetCursor,
  KeysetCursorDecodeErrorReasons,
  KeysetPaginationDirections,
  KeysetPaginationInputError,
  KeysetPaginationInputErrorReasons,
  paginateKeyset,
  parseKeysetPageSize,
} from "@mistle/http/pagination";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppContext } from "../../types.js";
import { IntegrationTargetsBadRequestCodes, IntegrationTargetsBadRequestError } from "./errors.js";

const PAGE_SIZE_OPTIONS = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

const CursorSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export type ListIntegrationTargetsInput = {
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
};

type IntegrationTargetListItem = {
  targetKey: string;
  familyId: string;
  variantId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  displayNameOverride?: string;
  descriptionOverride?: string;
};

type IntegrationTargetsCursor = z.infer<typeof CursorSchema>;

export async function listIntegrationTargets(
  db: AppContext["var"]["db"],
  input: ListIntegrationTargetsInput,
): Promise<KeysetPaginatedResult<IntegrationTargetListItem>> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PAGE_SIZE_OPTIONS);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new IntegrationTargetsBadRequestError(
        IntegrationTargetsBadRequestCodes.INVALID_LIST_TARGETS_INPUT,
        "`limit` must be an integer between 1 and 100.",
      );
    }

    throw error;
  }

  try {
    const result = await paginateKeyset<IntegrationTarget, IntegrationTargetsCursor>({
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

            return new IntegrationTargetsBadRequestError(
              IntegrationTargetsBadRequestCodes.INVALID_PAGINATION_CURSOR,
              reasonToMessage[reason],
            );
          },
        }),
      encodeCursor: encodeKeysetCursor,
      getCursor: (target) => ({
        targetKey: target.targetKey,
      }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) =>
        db.query.integrationTargets.findMany({
          where: (table, { and, eq, gt, lt }) => {
            const enabledScope = eq(table.enabled, true);

            if (cursor === undefined) {
              return enabledScope;
            }

            if (direction === KeysetPaginationDirections.FORWARD) {
              return and(enabledScope, gt(table.targetKey, cursor.targetKey));
            }

            return and(enabledScope, lt(table.targetKey, cursor.targetKey));
          },
          orderBy:
            direction === KeysetPaginationDirections.BACKWARD
              ? (table, { desc }) => [desc(table.targetKey)]
              : (table, { asc }) => [asc(table.targetKey)],
          limit: limitPlusOne,
        }),
      countTotalResults: async () => {
        const [result] = await db
          .select({
            totalResults: sql<number>`count(*)::int`,
          })
          .from(integrationTargets)
          .where(eq(integrationTargets.enabled, true));

        return result?.totalResults ?? 0;
      },
    });

    return {
      ...result,
      items: result.items.map((target) => ({
        targetKey: target.targetKey,
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: target.enabled,
        config: target.config,
        ...(target.displayNameOverride === null
          ? {}
          : { displayNameOverride: target.displayNameOverride }),
        ...(target.descriptionOverride === null
          ? {}
          : { descriptionOverride: target.descriptionOverride }),
      })),
    };
  } catch (error) {
    if (
      error instanceof KeysetPaginationInputError &&
      error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
    ) {
      throw new IntegrationTargetsBadRequestError(
        IntegrationTargetsBadRequestCodes.INVALID_LIST_TARGETS_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}
