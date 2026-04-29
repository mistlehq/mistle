import {
  integrationConnections,
  integrationWebhookSources,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
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
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import { buildIntegrationConnectionResponse } from "./build-integration-connection-response.js";
import { listActiveSandboxProfileBindingCountsByConnectionId } from "./list-active-sandbox-profile-binding-counts-by-connection-id.js";
import { listConfiguredSecretNamesByConnectionId } from "./list-configured-secret-names-by-connection-id.js";
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
  isIdentityLinked?: boolean;
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  connectionMethodId?: string;
  connectionMethodLabel?: string;
  configuredSecretNames?: string[];
  supportsWebhookSources?: boolean;
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

    const bindingCountsByConnectionId = await listActiveSandboxProfileBindingCountsByConnectionId({
      db,
      connectionIds: result.items.map((connection) => connection.id),
      organizationId: input.organizationId,
    });
    const automationCountsByConnectionId = await listAutomationCountsByConnectionId({
      db,
      connectionIds: result.items.map((connection) => connection.id),
    });
    const identityLinkedConnectionIds = await listIdentityLinkedConnectionIds({
      db,
      connectionIds: result.items.map((connection) => connection.id),
      organizationId: input.organizationId,
    });
    const configuredSecretNamesByConnectionId = await listConfiguredSecretNamesByConnectionId({
      connections: result.items,
      db,
      integrationRegistry,
    });

    return {
      ...result,
      items: await Promise.all(
        result.items.map(async (connection) => {
          const definition =
            connection.target === null
              ? undefined
              : integrationRegistry.getDefinition({
                  familyId: connection.target.familyId,
                  variantId: connection.target.variantId,
                });
          const supportsWebhookSources =
            connection.config === null || definition?.webhookSource === undefined
              ? undefined
              : ((await definition.webhookSource.supportsConnection?.({
                  connection: {
                    id: connection.id,
                    status: connection.status,
                    config: connection.config,
                  },
                })) ?? true);

          return {
            ...buildIntegrationConnectionResponse({
              connection,
              ...(definition === undefined
                ? {}
                : { connectionMethods: definition.connectionMethods }),
              configuredSecretNames: configuredSecretNamesByConnectionId.get(connection.id),
            }),
            ...buildResourceSummary(connection, {
              integrationRegistry,
            }),
            bindingCount: bindingCountsByConnectionId.get(connection.id) ?? 0,
            automationCount: automationCountsByConnectionId.get(connection.id) ?? 0,
            ...(identityLinkedConnectionIds.has(connection.id) ? { isIdentityLinked: true } : {}),
            ...(supportsWebhookSources === undefined ? {} : { supportsWebhookSources }),
            createdAt: normalizeTimestamp(connection.createdAt),
            updatedAt: normalizeTimestamp(connection.updatedAt),
          };
        }),
      ),
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

async function listIdentityLinkedConnectionIds(input: {
  db: ControlPlaneDatabase;
  connectionIds: readonly string[];
  organizationId: string;
}): Promise<Set<string>> {
  if (input.connectionIds.length === 0) {
    return new Set();
  }

  const rows = await input.db
    .select({
      connectionId: organizationIdentityLinkProviderConfigs.integrationConnectionId,
    })
    .from(organizationIdentityLinkProviderConfigs)
    .where(
      and(
        eq(organizationIdentityLinkProviderConfigs.organizationId, input.organizationId),
        eq(
          organizationIdentityLinkProviderConfigs.status,
          OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        ),
        inArray(organizationIdentityLinkProviderConfigs.integrationConnectionId, [
          ...input.connectionIds,
        ]),
      ),
    );

  return new Set(rows.map((row) => row.connectionId));
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
      resolvedConnectionId: integrationConnections.id,
      automationCount: sql<number>`count(*)::int`,
    })
    .from(webhookAutomations)
    .innerJoin(
      integrationWebhookSources,
      eq(integrationWebhookSources.id, webhookAutomations.integrationWebhookSourceId),
    )
    .innerJoin(
      integrationConnections,
      eq(integrationConnections.id, integrationWebhookSources.integrationConnectionId),
    )
    .where(inArray(integrationConnections.id, [...input.connectionIds]))
    .groupBy(integrationConnections.id);

  return new Map<string, number>(
    automationCounts.map((entry) => [entry.resolvedConnectionId, entry.automationCount]),
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
