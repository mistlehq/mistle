import { automations, AutomationKinds } from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { KeysetPaginatedResult } from "@mistle/http/pagination";
import {
  createKeysetPaginationQuerySchema,
  decodeKeysetCursorOrThrow,
  encodeKeysetCursor,
  KeysetCursorDecodeErrorReasons,
  KeysetPaginationDirections,
  KeysetPaginationInputError,
  KeysetPaginationInputErrorReasons,
  paginateKeyset,
  parseKeysetPageSize,
} from "@mistle/http/pagination";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { AutomationWebhooksBadRequestCodes, AutomationWebhooksBadRequestError } from "../errors.js";
import { loadWebhookAutomationAggregateOrThrow } from "../shared.js";
import type { AutomationWebhookAggregate } from "../types.js";

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

export const ListWebhookAutomationsQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: DEFAULT_PAGE_SIZE,
  maxLimit: MAX_PAGE_SIZE,
});

export type ListWebhookAutomationsInput = {
  organizationId: string;
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
};

export async function listAutomationWebhooks(
  { db }: { db: ControlPlaneDatabase },
  input: ListWebhookAutomationsInput,
): Promise<KeysetPaginatedResult<AutomationWebhookAggregate>> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PageSizeOptions);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AutomationWebhooksBadRequestError(
        AutomationWebhooksBadRequestCodes.INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT,
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

            return new AutomationWebhooksBadRequestError(
              AutomationWebhooksBadRequestCodes.INVALID_PAGINATION_CURSOR,
              reasonToMessage[reason],
            );
          },
        }),
      encodeCursor: encodeKeysetCursor,
      getCursor: (automation) => ({
        createdAt: automation.createdAt,
        id: automation.id,
      }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) => {
        const automationRows = await db.query.automations.findMany({
          where: (table, { and, eq, gt, lt, or }) => {
            const organizationScope = and(
              eq(table.organizationId, input.organizationId),
              eq(table.kind, AutomationKinds.WEBHOOK),
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
        });

        return Promise.all(
          automationRows.map((automation) =>
            loadWebhookAutomationAggregateOrThrow(db, {
              organizationId: input.organizationId,
              automationId: automation.id,
            }),
          ),
        );
      },
      countTotalResults: async () => {
        const [result] = await db
          .select({
            totalResults: sql<number>`count(*)::int`,
          })
          .from(automations)
          .where(
            and(
              eq(automations.organizationId, input.organizationId),
              eq(automations.kind, AutomationKinds.WEBHOOK),
            ),
          );

        return result?.totalResults ?? 0;
      },
    });
  } catch (error) {
    if (
      error instanceof KeysetPaginationInputError &&
      error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
    ) {
      throw new AutomationWebhooksBadRequestError(
        AutomationWebhooksBadRequestCodes.INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}
