import {
  integrationConnections,
  sandboxProfileVersionIntegrationBindings,
  webhookAutomations,
  type ControlPlaneDatabase,
  type IntegrationConnection,
  type IntegrationConnectionResourceState,
  type IntegrationConnectionResourceSyncState,
  type IntegrationConnectionStatus,
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
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
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
  bindingCount: number;
  automationCount: number;
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

type IntegrationConnectionListRow = IntegrationConnection & {
  target: {
    familyId: string;
    variantId: string;
  } | null;
  resourceStates: Array<IntegrationConnectionResourceState>;
};

export async function listIntegrationConnections(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: ListIntegrationConnectionsInput,
): Promise<KeysetPaginatedResult<IntegrationConnectionListItem>> {
  const { db, integrationRegistry } = ctx;
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PAGE_SIZE_OPTIONS);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTIONS_INPUT,
        "`limit` must be an integer between 1 and 100.",
      );
    }

    throw error;
  }

  try {
    const result = await paginateKeyset<IntegrationConnectionListRow, IntegrationConnectionsCursor>(
      {
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
            with: {
              resourceStates: true,
              target: {
                columns: {
                  familyId: true,
                  variantId: true,
                },
              },
            },
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
      },
    );

    const bindingCountsByConnectionId = await listBindingCountsByConnectionId({
      db,
      connectionIds: result.items.map((connection) => connection.id),
    });
    const automationCountsByConnectionId = await listAutomationCountsByConnectionId({
      db,
      connectionIds: result.items.map((connection) => connection.id),
    });

    return {
      ...result,
      items: result.items.map((connection) => ({
        ...buildResourceSummary(connection, {
          integrationRegistry,
        }),
        id: connection.id,
        targetKey: connection.targetKey,
        displayName: connection.displayName,
        status: connection.status,
        bindingCount: bindingCountsByConnectionId.get(connection.id) ?? 0,
        automationCount: automationCountsByConnectionId.get(connection.id) ?? 0,
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
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTIONS_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}

async function listBindingCountsByConnectionId(input: {
  db: ControlPlaneDatabase;
  connectionIds: readonly string[];
}): Promise<Map<string, number>> {
  if (input.connectionIds.length === 0) {
    return new Map();
  }

  const bindingCounts = await input.db
    .select({
      connectionId: sandboxProfileVersionIntegrationBindings.connectionId,
      bindingCount: sql<number>`count(*)::int`,
    })
    .from(sandboxProfileVersionIntegrationBindings)
    .where(inArray(sandboxProfileVersionIntegrationBindings.connectionId, [...input.connectionIds]))
    .groupBy(sandboxProfileVersionIntegrationBindings.connectionId);

  return new Map(bindingCounts.map((entry) => [entry.connectionId, entry.bindingCount] as const));
}

async function listAutomationCountsByConnectionId(input: {
  db: ControlPlaneDatabase;
  connectionIds: readonly string[];
}): Promise<Map<string, number>> {
  if (input.connectionIds.length === 0) {
    return new Map();
  }

  const automationCounts = await input.db
    .select({
      connectionId: webhookAutomations.integrationConnectionId,
      automationCount: sql<number>`count(*)::int`,
    })
    .from(webhookAutomations)
    .where(inArray(webhookAutomations.integrationConnectionId, [...input.connectionIds]))
    .groupBy(webhookAutomations.integrationConnectionId);

  return new Map(
    automationCounts.map((entry) => [entry.connectionId, entry.automationCount] as const),
  );
}

function normalizeTimestamp(value: string | Date): string {
  return new Date(value).toISOString();
}

function buildResourceSummary(
  connection: IntegrationConnectionListRow,
  input: {
    integrationRegistry: IntegrationRegistry;
  },
): Pick<IntegrationConnectionListItem, "resources"> {
  const target = connection.target;
  if (target === null) {
    return {};
  }

  const definition = input.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  const resources = projectConnectionResourceSummaries({
    definition,
    resourceStates: connection.resourceStates,
  });

  return resources.length === 0 ? {} : { resources };
}
