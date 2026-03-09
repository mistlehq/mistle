import {
  integrationConnections,
  type IntegrationConnection,
  type IntegrationConnectionResourceState,
  type IntegrationConnectionResourceSyncState,
  type IntegrationConnectionStatus,
  type IntegrationTarget,
} from "@mistle/db/control-plane";
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
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsBadRequestError,
} from "./errors.js";
import { projectConnectionResourceSummaries } from "./project-connection-resource-summaries.js";

const PAGE_SIZE_OPTIONS = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

const CursorSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

type IntegrationConnectionsCursor = z.infer<typeof CursorSchema>;

export type ListIntegrationConnectionsInput = {
  organizationId: string;
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
};

type IntegrationConnectionListItem = {
  id: string;
  targetKey: string;
  displayName: string;
  status: IntegrationConnectionStatus;
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  resources?: Array<{
    kind: string;
    selectionMode: "single" | "multi";
    count: number;
    syncState: IntegrationConnectionResourceSyncState;
    lastSyncedAt?: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export async function listIntegrationConnections(
  db: AppContext["var"]["db"],
  integrationRegistry: AppContext["var"]["integrationRegistry"],
  input: ListIntegrationConnectionsInput,
): Promise<KeysetPaginatedResult<IntegrationConnectionListItem>> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PAGE_SIZE_OPTIONS);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new IntegrationConnectionsBadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTIONS_INPUT,
        "`limit` must be an integer between 1 and 100.",
      );
    }

    throw error;
  }

  try {
    const result = await paginateKeyset<IntegrationConnection, IntegrationConnectionsCursor>({
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

            return new IntegrationConnectionsBadRequestError(
              IntegrationConnectionsBadRequestCodes.INVALID_PAGINATION_CURSOR,
              reasonToMessage[reason],
            );
          },
        }),
      encodeCursor: encodeKeysetCursor,
      getCursor: (connection) => ({
        id: connection.id,
      }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) =>
        db.query.integrationConnections.findMany({
          where: (table, { and, eq, gt, lt }) => {
            const organizationScope = eq(table.organizationId, input.organizationId);

            if (cursor === undefined) {
              return organizationScope;
            }

            if (direction === KeysetPaginationDirections.FORWARD) {
              return and(organizationScope, gt(table.id, cursor.id));
            }

            return and(organizationScope, lt(table.id, cursor.id));
          },
          orderBy:
            direction === KeysetPaginationDirections.BACKWARD
              ? (table, { desc }) => [desc(table.id)]
              : (table, { asc }) => [asc(table.id)],
          limit: limitPlusOne,
        }),
      countTotalResults: async () => {
        const [result] = await db
          .select({
            totalResults: sql<number>`count(*)::int`,
          })
          .from(integrationConnections)
          .where(eq(integrationConnections.organizationId, input.organizationId));

        return result?.totalResults ?? 0;
      },
    });

    const pageTargetKeys = [...new Set(result.items.map((connection) => connection.targetKey))];
    const pageConnectionIds = result.items.map((connection) => connection.id);

    const [targets, resourceStates] = await Promise.all([
      pageTargetKeys.length === 0
        ? Promise.resolve([])
        : db.query.integrationTargets.findMany({
            where: (table, { inArray }) => inArray(table.targetKey, pageTargetKeys),
          }),
      pageConnectionIds.length === 0
        ? Promise.resolve([])
        : db.query.integrationConnectionResourceStates.findMany({
            where: (table, { inArray }) => inArray(table.connectionId, pageConnectionIds),
          }),
    ]);

    const targetsByKey = new Map(targets.map((target) => [target.targetKey, target]));
    const resourceStatesByConnectionId = new Map<
      string,
      Array<IntegrationConnectionResourceState>
    >();

    for (const resourceState of resourceStates) {
      const existingStates = resourceStatesByConnectionId.get(resourceState.connectionId);
      if (existingStates === undefined) {
        resourceStatesByConnectionId.set(resourceState.connectionId, [resourceState]);
        continue;
      }

      existingStates.push(resourceState);
    }

    return {
      ...result,
      items: result.items.map((connection) => ({
        ...buildResourceSummary(connection, {
          integrationRegistry,
          targetsByKey,
          resourceStatesByConnectionId,
        }),
        id: connection.id,
        targetKey: connection.targetKey,
        displayName: connection.displayName,
        status: connection.status,
        ...(connection.externalSubjectId === null
          ? {}
          : { externalSubjectId: connection.externalSubjectId }),
        ...(connection.config === null ? {} : { config: connection.config }),
        ...(connection.targetSnapshotConfig === null
          ? {}
          : { targetSnapshotConfig: connection.targetSnapshotConfig }),
        createdAt: normalizeTimestamp(connection.createdAt),
        updatedAt: normalizeTimestamp(connection.updatedAt),
      })),
    };
  } catch (error) {
    if (
      error instanceof KeysetPaginationInputError &&
      error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
    ) {
      throw new IntegrationConnectionsBadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTIONS_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}

function normalizeTimestamp(value: string | Date): string {
  return new Date(value).toISOString();
}

function buildResourceSummary(
  connection: IntegrationConnection,
  input: {
    integrationRegistry: AppContext["var"]["integrationRegistry"];
    targetsByKey: ReadonlyMap<string, IntegrationTarget>;
    resourceStatesByConnectionId: ReadonlyMap<
      string,
      ReadonlyArray<IntegrationConnectionResourceState>
    >;
  },
): Pick<IntegrationConnectionListItem, "resources"> {
  const target = input.targetsByKey.get(connection.targetKey);
  if (target === undefined) {
    return {};
  }

  const definition = input.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  const resources = projectConnectionResourceSummaries({
    definition,
    resourceStates: input.resourceStatesByConnectionId.get(connection.id) ?? [],
  });

  return resources.length === 0 ? {} : { resources };
}
