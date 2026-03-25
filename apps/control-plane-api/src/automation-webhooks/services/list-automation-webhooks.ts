import {
  automations,
  automationTargets,
  AutomationKinds,
  integrationConnections,
  integrationTargets,
  sandboxProfiles,
  webhookAutomations,
} from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
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
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { resolveTargetMetadataFromPersistedTarget } from "../../integration-targets/services/resolve-target-metadata.js";
import { AutomationWebhooksBadRequestCodes } from "../constants.js";

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

export type AutomationWebhookListItem = {
  id: string;
  name: string;
  enabled: boolean;
  targetName: string;
  issue?: {
    code: "MISSING_TARGET_METADATA";
    message: string;
  };
  events: {
    label: string;
    logoKey?: string;
    unavailable?: boolean;
  }[];
  updatedAt: string;
};

type AutomationWebhookListPageItem = AutomationWebhookListItem & {
  createdAt: string;
};

function createTriggerId(input: { connectionId: string; eventType: string }): string {
  return `${input.connectionId}::${input.eventType}`;
}

function resolveAutomationListEvents(input: {
  eventTypes: string[] | null;
  integrationConnectionId: string;
  supportedWebhookEvents?: {
    eventType: string;
    displayName: string;
  }[];
  logoKey?: string;
}): AutomationWebhookListItem["events"] {
  const supportedEventMap = new Map(
    (input.supportedWebhookEvents ?? []).map((eventDefinition) => [
      createTriggerId({
        connectionId: input.integrationConnectionId,
        eventType: eventDefinition.eventType,
      }),
      eventDefinition,
    ]),
  );

  if (input.eventTypes === null || input.eventTypes.length === 0) {
    return [
      {
        label: "All events",
        ...(input.logoKey === undefined ? {} : { logoKey: input.logoKey }),
      },
    ];
  }

  return input.eventTypes.map((eventType) => {
    const eventDefinition = supportedEventMap.get(
      createTriggerId({
        connectionId: input.integrationConnectionId,
        eventType,
      }),
    );

    if (eventDefinition === undefined) {
      return {
        label: eventType,
        unavailable: true,
      };
    }

    return {
      label: eventDefinition.displayName,
      ...(input.logoKey === undefined ? {} : { logoKey: input.logoKey }),
    };
  });
}

function resolveUnavailableAutomationListEvents(input: {
  eventTypes: string[] | null;
}): AutomationWebhookListItem["events"] {
  if (input.eventTypes === null || input.eventTypes.length === 0) {
    return [
      {
        label: "All events",
        unavailable: true,
      },
    ];
  }

  return input.eventTypes.map((eventType) => ({
    label: eventType,
    unavailable: true,
  }));
}

type AutomationListPageRow = {
  automationId: string;
  automationName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  eventTypes: string[] | null;
  integrationConnectionId: string;
  sandboxProfileDisplayName: string;
  integrationTargetFamilyId: string;
  integrationTargetVariantId: string;
  integrationTargetDisplayNameOverride: string | null;
  integrationTargetDescriptionOverride: string | null;
};

function createAutomationListPageItem(row: AutomationListPageRow): AutomationWebhookListPageItem {
  try {
    const targetMetadata = resolveTargetMetadataFromPersistedTarget({
      familyId: row.integrationTargetFamilyId,
      variantId: row.integrationTargetVariantId,
      displayNameOverride: row.integrationTargetDisplayNameOverride,
      descriptionOverride: row.integrationTargetDescriptionOverride,
    });

    return {
      id: row.automationId,
      name: row.automationName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      targetName: row.sandboxProfileDisplayName,
      events: resolveAutomationListEvents({
        eventTypes: row.eventTypes,
        integrationConnectionId: row.integrationConnectionId,
        ...(targetMetadata.supportedWebhookEvents === undefined
          ? {}
          : {
              supportedWebhookEvents: targetMetadata.supportedWebhookEvents.map(
                (eventDefinition) => ({
                  eventType: eventDefinition.eventType,
                  displayName: eventDefinition.displayName,
                }),
              ),
            }),
        ...(targetMetadata.logoKey === undefined ? {} : { logoKey: targetMetadata.logoKey }),
      }),
      updatedAt: row.updatedAt,
    };
  } catch {
    return {
      id: row.automationId,
      name: row.automationName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      targetName: row.sandboxProfileDisplayName,
      issue: {
        code: "MISSING_TARGET_METADATA",
        message:
          "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
      },
      events: resolveUnavailableAutomationListEvents({
        eventTypes: row.eventTypes,
      }),
      updatedAt: row.updatedAt,
    };
  }
}

async function loadAutomationListPageRows(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  automationIds: readonly string[];
}): Promise<AutomationWebhookListPageItem[]> {
  if (input.automationIds.length === 0) {
    return [];
  }

  const rows = await input.db
    .select({
      automationId: automations.id,
      automationName: automations.name,
      enabled: automations.enabled,
      createdAt: automations.createdAt,
      updatedAt: automations.updatedAt,
      eventTypes: webhookAutomations.eventTypes,
      integrationConnectionId: webhookAutomations.integrationConnectionId,
      integrationTargetKey: integrationConnections.targetKey,
      sandboxProfileDisplayName: sandboxProfiles.displayName,
      integrationTargetFamilyId: integrationTargets.familyId,
      integrationTargetVariantId: integrationTargets.variantId,
      integrationTargetDisplayNameOverride: integrationTargets.displayNameOverride,
      integrationTargetDescriptionOverride: integrationTargets.descriptionOverride,
    })
    .from(automations)
    .innerJoin(webhookAutomations, eq(webhookAutomations.automationId, automations.id))
    .innerJoin(
      integrationConnections,
      eq(integrationConnections.id, webhookAutomations.integrationConnectionId),
    )
    .innerJoin(
      integrationTargets,
      eq(integrationTargets.targetKey, integrationConnections.targetKey),
    )
    .innerJoin(automationTargets, eq(automationTargets.automationId, automations.id))
    .innerJoin(sandboxProfiles, eq(sandboxProfiles.id, automationTargets.sandboxProfileId))
    .where(
      and(
        eq(automations.organizationId, input.organizationId),
        eq(automations.kind, AutomationKinds.WEBHOOK),
        inArray(automations.id, input.automationIds),
      ),
    );

  const groupedRows = new Map<string, AutomationListPageRow[]>();

  for (const row of rows) {
    const automationRows = groupedRows.get(row.automationId);
    if (automationRows === undefined) {
      groupedRows.set(row.automationId, [row]);
      continue;
    }

    automationRows.push(row);
  }

  const rowsByAutomationId = new Map<string, AutomationWebhookListPageItem>();

  for (const [automationId, automationRows] of groupedRows.entries()) {
    if (automationRows.length !== 1) {
      throw new Error(
        `Webhook automation '${automationId}' must have exactly one automation target.`,
      );
    }

    const automationRow = automationRows[0];
    if (automationRow === undefined) {
      throw new Error(
        `Webhook automation '${automationId}' could not be loaded for the list page.`,
      );
    }

    rowsByAutomationId.set(automationId, createAutomationListPageItem(automationRow));
  }

  return input.automationIds.map((automationId) => {
    const row = rowsByAutomationId.get(automationId);
    if (row === undefined) {
      throw new Error(
        `Webhook automation '${automationId}' could not be loaded for the list page.`,
      );
    }

    return row;
  });
}

export async function listAutomationWebhooks(
  ctx: { db: ControlPlaneDatabase },
  input: ListWebhookAutomationsInput,
): Promise<KeysetPaginatedResult<AutomationWebhookListItem>> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PageSizeOptions);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        AutomationWebhooksBadRequestCodes.INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT,
        `\`limit\` must be an integer between 1 and ${String(MAX_PAGE_SIZE)}.`,
      );
    }

    throw error;
  }

  try {
    const result = await paginateKeyset<
      AutomationWebhookListPageItem,
      z.infer<typeof CursorSchema>
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

            return new BadRequestError(
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
        const automationRows = await ctx.db.query.automations.findMany({
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

        return loadAutomationListPageRows({
          db: ctx.db,
          organizationId: input.organizationId,
          automationIds: automationRows.map((automation) => automation.id),
        });
      },
      countTotalResults: async () => {
        const [result] = await ctx.db
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

    return {
      ...result,
      items: result.items.map(({ createdAt: _createdAt, ...item }) => item),
    };
  } catch (error) {
    if (
      error instanceof KeysetPaginationInputError &&
      error.reason === KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED
    ) {
      throw new BadRequestError(
        AutomationWebhooksBadRequestCodes.INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}
