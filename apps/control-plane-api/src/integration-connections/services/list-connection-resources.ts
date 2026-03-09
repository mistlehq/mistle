import {
  integrationConnectionResources,
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  type IntegrationConnection,
  type IntegrationConnectionResource,
  type IntegrationConnectionResourceState,
  type IntegrationConnectionResourceSyncState,
} from "@mistle/db/control-plane";
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
import { and, eq, gt, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsConflictError,
  IntegrationConnectionsNotFoundCodes,
  IntegrationConnectionsNotFoundError,
} from "./errors.js";

const PAGE_SIZE_OPTIONS = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

const CursorSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

type IntegrationConnectionResourcesCursor = z.infer<typeof CursorSchema>;

export type ListIntegrationConnectionResourcesInput = {
  organizationId: string;
  connectionId: string;
  kind: string;
  search?: string | undefined;
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
};

export type IntegrationConnectionResourceListItem = {
  id: string;
  familyId: string;
  kind: string;
  externalId?: string;
  handle: string;
  displayName: string;
  status: "accessible";
  metadata: Record<string, unknown>;
};

export type ListIntegrationConnectionResourcesResult = {
  connectionId: string;
  familyId: string;
  kind: string;
  syncState: IntegrationConnectionResourceSyncState;
  lastSyncedAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  items: Array<IntegrationConnectionResourceListItem>;
  page: {
    totalResults: number;
    nextCursor: string | null;
    previousCursor: string | null;
  };
};

export async function listIntegrationConnectionResources(
  db: AppContext["var"]["db"],
  integrationRegistry: AppContext["var"]["integrationRegistry"],
  input: ListIntegrationConnectionResourcesInput,
): Promise<ListIntegrationConnectionResourcesResult> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PAGE_SIZE_OPTIONS);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new IntegrationConnectionsBadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTION_RESOURCES_INPUT,
        "`limit` must be an integer between 1 and 100.",
      );
    }

    throw error;
  }

  const connection = await db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.organizationId, input.organizationId), eq(table.id, input.connectionId)),
    with: {
      target: {
        columns: {
          familyId: true,
          variantId: true,
        },
      },
    },
  });

  if (connection === undefined) {
    throw new IntegrationConnectionsNotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      "Integration connection was not found.",
    );
  }

  const target = connection.target;
  if (target === null) {
    throw new Error("Expected integration connection target relation to be present.");
  }

  ensureResourceKindIsSupported(integrationRegistry, connection, target, input.kind);

  const resourceState = await db.query.integrationConnectionResourceStates.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.connectionId, connection.id), eq(table.kind, input.kind)),
  });

  assertResourceStateIsReadable(resourceState);

  try {
    const paginatedResources = await paginateKeyset<
      IntegrationConnectionResource,
      IntegrationConnectionResourcesCursor
    >({
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
              IntegrationConnectionsBadRequestCodes.INVALID_RESOURCE_PAGINATION_CURSOR,
              reasonToMessage[reason],
            );
          },
        }),
      encodeCursor: encodeKeysetCursor,
      getCursor: (resource) => ({
        id: resource.id,
      }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) =>
        db.query.integrationConnectionResources.findMany({
          where: () =>
            buildResourceWhereClause({
              connectionId: connection.id,
              familyId: target.familyId,
              kind: input.kind,
              search: input.search,
              ...(cursor === undefined
                ? {}
                : {
                    cursorId: cursor.id,
                    direction,
                  }),
            }),
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
          .from(integrationConnectionResources)
          .where(
            buildResourceWhereClause({
              connectionId: connection.id,
              familyId: target.familyId,
              kind: input.kind,
              search: input.search,
            }),
          );

        return result?.totalResults ?? 0;
      },
    });

    return {
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.kind,
      syncState: resourceState?.syncState ?? IntegrationConnectionResourceSyncStates.READY,
      ...(resourceState?.lastSyncedAt === null || resourceState?.lastSyncedAt === undefined
        ? {}
        : { lastSyncedAt: normalizeTimestamp(resourceState.lastSyncedAt) }),
      ...(resourceState?.syncState !== IntegrationConnectionResourceSyncStates.ERROR ||
      resourceState.lastSyncedAt === null ||
      resourceState.lastSyncedAt === undefined ||
      resourceState.lastErrorCode === null
        ? {}
        : { lastErrorCode: resourceState.lastErrorCode }),
      ...(resourceState?.syncState !== IntegrationConnectionResourceSyncStates.ERROR ||
      resourceState.lastSyncedAt === null ||
      resourceState.lastSyncedAt === undefined ||
      resourceState.lastErrorMessage === null
        ? {}
        : { lastErrorMessage: resourceState.lastErrorMessage }),
      items: paginatedResources.items.map((resource) => ({
        id: resource.id,
        familyId: resource.familyId,
        kind: resource.kind,
        ...(resource.externalId === null ? {} : { externalId: resource.externalId }),
        handle: resource.handle,
        displayName: resource.displayName,
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        metadata: resource.metadata,
      })),
      page: {
        totalResults: paginatedResources.totalResults,
        nextCursor: paginatedResources.nextPage?.after ?? null,
        previousCursor: paginatedResources.previousPage?.before ?? null,
      },
    };
  } catch (error) {
    if (
      error instanceof KeysetPaginationInputError &&
      error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
    ) {
      throw new IntegrationConnectionsBadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTION_RESOURCES_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}

function ensureResourceKindIsSupported(
  integrationRegistry: AppContext["var"]["integrationRegistry"],
  connection: IntegrationConnection,
  target: {
    familyId: string;
    variantId: string;
  },
  kind: string,
) {
  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  const isSupported = (definition?.resourceDefinitions ?? []).some(
    (resourceDefinition) => resourceDefinition.kind === kind,
  );

  if (!isSupported) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.RESOURCE_KIND_NOT_SUPPORTED,
      `Resource kind \`${kind}\` is not supported for connection \`${connection.id}\`.`,
    );
  }
}

function assertResourceStateIsReadable(
  resourceState: IntegrationConnectionResourceState | undefined,
) {
  if (
    resourceState === undefined ||
    resourceState.syncState === IntegrationConnectionResourceSyncStates.NEVER_SYNCED
  ) {
    throw new IntegrationConnectionsConflictError({
      code: IntegrationConnectionsConflictCodes.RESOURCE_SYNC_REQUIRED,
      message: "Resource sync is required before resources can be listed.",
    });
  }

  if (
    resourceState.syncState === IntegrationConnectionResourceSyncStates.SYNCING &&
    resourceState.lastSyncedAt === null
  ) {
    throw new IntegrationConnectionsConflictError({
      code: IntegrationConnectionsConflictCodes.RESOURCE_SYNC_IN_PROGRESS,
      message: "Resource sync is still in progress and no previous snapshot is available yet.",
    });
  }

  if (
    resourceState.syncState === IntegrationConnectionResourceSyncStates.ERROR &&
    resourceState.lastSyncedAt === null
  ) {
    throw new IntegrationConnectionsConflictError({
      code: IntegrationConnectionsConflictCodes.RESOURCE_SYNC_FAILED,
      message: "Resource sync failed before any usable snapshot was stored.",
      ...(resourceState.lastErrorCode === null
        ? {}
        : { lastErrorCode: resourceState.lastErrorCode }),
      ...(resourceState.lastErrorMessage === null
        ? {}
        : { lastErrorMessage: resourceState.lastErrorMessage }),
    });
  }
}

function buildResourceWhereClause(input: {
  connectionId: string;
  familyId: string;
  kind: string;
  search?: string | undefined;
  direction?: (typeof KeysetPaginationDirections)[keyof typeof KeysetPaginationDirections];
  cursorId?: string;
}) {
  const normalizedSearch = normalizeSearch(input.search);

  return and(
    eq(integrationConnectionResources.connectionId, input.connectionId),
    eq(integrationConnectionResources.familyId, input.familyId),
    eq(integrationConnectionResources.kind, input.kind),
    eq(integrationConnectionResources.status, IntegrationConnectionResourceStatuses.ACCESSIBLE),
    normalizedSearch === undefined
      ? undefined
      : or(
          ilike(integrationConnectionResources.displayName, `%${normalizedSearch}%`),
          ilike(integrationConnectionResources.handle, `%${normalizedSearch}%`),
        ),
    input.cursorId === undefined || input.direction === undefined
      ? undefined
      : input.direction === KeysetPaginationDirections.FORWARD
        ? gt(integrationConnectionResources.id, input.cursorId)
        : lt(integrationConnectionResources.id, input.cursorId),
  );
}

function normalizeSearch(search: string | undefined): string | undefined {
  const trimmedSearch = search?.trim();
  return trimmedSearch === undefined || trimmedSearch.length === 0 ? undefined : trimmedSearch;
}

function normalizeTimestamp(value: string | Date): string {
  return new Date(value).toISOString();
}
