import {
  getControlPlaneDatabaseSchema,
  type ApiKey,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { OrganizationPermission } from "../../auth/services/organization-policy.js";
import { ApiKeysBadRequestCodes } from "../constants.js";
import { projectApiKey, type ApiKeyResponse } from "./api-key-projection.js";
import { parseApiKeyPermissions } from "./permissions.js";

const PAGE_SIZE_OPTIONS = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

const CursorSchema = z
  .object({
    createdAt: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

type ApiKeysCursor = z.infer<typeof CursorSchema>;

export type ListApiKeysInput = {
  organizationId: string;
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
};

export async function listApiKeys(
  ctx: { db: ControlPlaneDatabase },
  input: ListApiKeysInput,
): Promise<KeysetPaginatedResult<ApiKeyResponse>> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PAGE_SIZE_OPTIONS);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        ApiKeysBadRequestCodes.INVALID_LIST_API_KEYS_INPUT,
        "`limit` must be an integer between 1 and 100.",
      );
    }

    throw error;
  }

  try {
    const result = await paginateKeyset<ApiKey, ApiKeysCursor>({
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

            return new BadRequestError(
              ApiKeysBadRequestCodes.INVALID_PAGINATION_CURSOR,
              reasonToMessage[reason],
            );
          },
        }),
      encodeCursor: encodeKeysetCursor,
      getCursor: (apiKey) => ({
        createdAt: apiKey.createdAt,
        id: apiKey.id,
      }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) =>
        ctx.db.query.apiKeys.findMany({
          where: (table, { and, eq, gt, isNull, lt, or }) => {
            const activeOrganizationScope = and(
              eq(table.organizationId, input.organizationId),
              isNull(table.revokedAt),
            );

            if (cursor === undefined) {
              return activeOrganizationScope;
            }

            if (direction === KeysetPaginationDirections.FORWARD) {
              return and(
                activeOrganizationScope,
                or(
                  lt(table.createdAt, cursor.createdAt),
                  and(eq(table.createdAt, cursor.createdAt), lt(table.id, cursor.id)),
                ),
              );
            }

            return and(
              activeOrganizationScope,
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
        const tables = getControlPlaneDatabaseSchema(ctx.db);

        const [result] = await ctx.db
          .select({
            totalResults: sql<number>`count(*)::int`,
          })
          .from(tables.apiKeys)
          .where(
            and(
              eq(tables.apiKeys.organizationId, input.organizationId),
              isNull(tables.apiKeys.revokedAt),
            ),
          );

        return result?.totalResults ?? 0;
      },
    });

    const permissionsByApiKeyId = await listPermissionsByApiKeyId({
      db: ctx.db,
      apiKeyIds: result.items.map((apiKey) => apiKey.id),
    });

    return {
      ...result,
      items: result.items.map((apiKey) =>
        projectApiKey({
          apiKey,
          permissions: permissionsByApiKeyId.get(apiKey.id) ?? [],
        }),
      ),
    };
  } catch (error) {
    if (
      error instanceof KeysetPaginationInputError &&
      error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
    ) {
      throw new BadRequestError(
        ApiKeysBadRequestCodes.INVALID_LIST_API_KEYS_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}

async function listPermissionsByApiKeyId(input: {
  db: ControlPlaneDatabase;
  apiKeyIds: readonly string[];
}): Promise<Map<string, OrganizationPermission[]>> {
  const permissionsByApiKeyId = new Map<string, OrganizationPermission[]>();
  if (input.apiKeyIds.length === 0) {
    return permissionsByApiKeyId;
  }

  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      apiKeyId: tables.apiKeyPermissions.apiKeyId,
      permission: tables.apiKeyPermissions.permission,
    })
    .from(tables.apiKeyPermissions)
    .where(inArray(tables.apiKeyPermissions.apiKeyId, input.apiKeyIds));

  for (const row of rows) {
    const permissions = permissionsByApiKeyId.get(row.apiKeyId) ?? [];
    permissions.push(...parseApiKeyPermissions([row.permission]));
    permissionsByApiKeyId.set(row.apiKeyId, permissions);
  }

  return permissionsByApiKeyId;
}
