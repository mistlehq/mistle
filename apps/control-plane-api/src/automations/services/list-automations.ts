import {
  AutomationKinds,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { AutomationKind, ControlPlaneDatabase } from "@mistle/db/control-plane";
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
import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  hasTargetDefinition,
  resolveTargetMetadataFromPersistedTarget,
} from "../../integration-targets/services/resolve-target-metadata.js";
import { AutomationsBadRequestCodes } from "../constants.js";

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

export const ListAutomationsQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: DEFAULT_PAGE_SIZE,
  maxLimit: MAX_PAGE_SIZE,
}).extend({
  sandboxProfileId: z.string().min(1).optional(),
});

export type ListAutomationsInput = {
  organizationId: string;
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
  sandboxProfileId?: string | undefined;
};

type AutomationListIssue = {
  code:
    | "MISSING_TARGET_METADATA"
    | "MISSING_WEBHOOK_SOURCE"
    | "MISSING_INTEGRATION_CONNECTION"
    | "MISSING_SANDBOX_PROFILE";
  message: string;
};

type AutomationListTarget = {
  sandboxProfileId: string;
  sandboxProfileName: string | null;
  primaryRepositoryId: string | null;
  primaryRepositoryName: string | null;
};

type AutomationListWebhookEvent = {
  label: string;
  logoKey?: string;
  unavailable?: boolean;
};

export type AutomationListItem = {
  id: string;
  kind: AutomationKind;
  name: string;
  enabled: boolean;
  target: AutomationListTarget;
  issue?: AutomationListIssue;
  source:
    | {
        kind: "webhook";
        events: AutomationListWebhookEvent[];
      }
    | {
        kind: "schedule";
        cronExpression: string;
        timezone: string;
        nextScheduledAt: string | null;
      };
  updatedAt: string;
};

type AutomationListPageItem = AutomationListItem & {
  createdAt: string;
};

type AutomationPageReference = {
  id: string;
  kind: AutomationKind;
  createdAt: string;
};

type ControlPlaneTables = ReturnType<typeof getControlPlaneDatabaseSchema>;

function resolveAutomationListEvents(input: {
  eventTypes: string[] | null;
  supportedWebhookEvents?: {
    eventType: string;
    displayName: string;
  }[];
  logoKey?: string;
}): AutomationListWebhookEvent[] {
  const supportedEventMap = new Map(
    (input.supportedWebhookEvents ?? []).map((eventDefinition) => [
      eventDefinition.eventType,
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
    const eventDefinition = supportedEventMap.get(eventType);

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
}): AutomationListWebhookEvent[] {
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

function createListTarget(input: {
  sandboxProfileId: string;
  sandboxProfileDisplayName: string | null;
  primaryRepositoryId: string | null;
}): AutomationListTarget {
  return {
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileName: input.sandboxProfileDisplayName,
    primaryRepositoryId: input.primaryRepositoryId,
    primaryRepositoryName: input.primaryRepositoryId,
  };
}

type WebhookAutomationListPageRow = {
  automationId: string;
  automationName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  eventTypes: string[] | null;
  integrationWebhookSourceId: string;
  resolvedIntegrationWebhookSourceId: string | null;
  resolvedIntegrationConnectionId: string | null;
  sandboxProfileId: string;
  sandboxProfileDisplayName: string | null;
  primaryRepositoryId: string | null;
  integrationTargetFamilyId: string | null;
  integrationTargetVariantId: string | null;
  integrationTargetDisplayNameOverride: string | null;
  integrationTargetDescriptionOverride: string | null;
};

function createWebhookAutomationListPageItem(
  row: WebhookAutomationListPageRow,
): AutomationListPageItem {
  const target = createListTarget({
    sandboxProfileId: row.sandboxProfileId,
    sandboxProfileDisplayName: row.sandboxProfileDisplayName,
    primaryRepositoryId: row.primaryRepositoryId,
  });

  if (row.sandboxProfileDisplayName === null) {
    return {
      id: row.automationId,
      kind: AutomationKinds.WEBHOOK,
      name: row.automationName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_SANDBOX_PROFILE",
        message:
          "This automation references a sandbox profile that is no longer available. The target name may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableAutomationListEvents({
          eventTypes: row.eventTypes,
        }),
      },
      updatedAt: row.updatedAt,
    };
  }

  if (row.resolvedIntegrationWebhookSourceId === null) {
    return {
      id: row.automationId,
      kind: AutomationKinds.WEBHOOK,
      name: row.automationName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_WEBHOOK_SOURCE",
        message:
          "This automation references a webhook source that is no longer available. Event metadata may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableAutomationListEvents({
          eventTypes: row.eventTypes,
        }),
      },
      updatedAt: row.updatedAt,
    };
  }

  if (row.resolvedIntegrationConnectionId === null) {
    return {
      id: row.automationId,
      kind: AutomationKinds.WEBHOOK,
      name: row.automationName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_INTEGRATION_CONNECTION",
        message:
          "This automation references an integration connection that is no longer available. Event metadata may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableAutomationListEvents({
          eventTypes: row.eventTypes,
        }),
      },
      updatedAt: row.updatedAt,
    };
  }

  if (row.integrationTargetFamilyId === null || row.integrationTargetVariantId === null) {
    return {
      id: row.automationId,
      kind: AutomationKinds.WEBHOOK,
      name: row.automationName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_TARGET_METADATA",
        message:
          "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableAutomationListEvents({
          eventTypes: row.eventTypes,
        }),
      },
      updatedAt: row.updatedAt,
    };
  }

  if (
    !hasTargetDefinition({
      familyId: row.integrationTargetFamilyId,
      variantId: row.integrationTargetVariantId,
    })
  ) {
    return {
      id: row.automationId,
      kind: AutomationKinds.WEBHOOK,
      name: row.automationName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_TARGET_METADATA",
        message:
          "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableAutomationListEvents({
          eventTypes: row.eventTypes,
        }),
      },
      updatedAt: row.updatedAt,
    };
  }

  const targetMetadata = resolveTargetMetadataFromPersistedTarget({
    familyId: row.integrationTargetFamilyId,
    variantId: row.integrationTargetVariantId,
    displayNameOverride: row.integrationTargetDisplayNameOverride,
    descriptionOverride: row.integrationTargetDescriptionOverride,
  });

  return {
    id: row.automationId,
    kind: AutomationKinds.WEBHOOK,
    name: row.automationName,
    enabled: row.enabled,
    createdAt: row.createdAt,
    target,
    source: {
      kind: "webhook",
      events: resolveAutomationListEvents({
        eventTypes: row.eventTypes,
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
    },
    updatedAt: row.updatedAt,
  };
}

function createScheduleAutomationListPageItem(
  row: ScheduleAutomationListPageRow,
): AutomationListPageItem {
  const target = createListTarget({
    sandboxProfileId: row.sandboxProfileId,
    sandboxProfileDisplayName: row.sandboxProfileDisplayName,
    primaryRepositoryId: row.primaryRepositoryId,
  });

  return {
    id: row.automationId,
    kind: AutomationKinds.SCHEDULE,
    name: row.automationName,
    enabled: row.enabled,
    createdAt: row.createdAt,
    target,
    ...(row.sandboxProfileDisplayName === null
      ? {
          issue: {
            code: "MISSING_SANDBOX_PROFILE",
            message:
              "This automation references a sandbox profile that is no longer available. The target name may be incomplete.",
          },
        }
      : {}),
    source: {
      kind: "schedule",
      cronExpression: row.cronExpression,
      timezone: row.timezone,
      nextScheduledAt: row.nextScheduledAt,
    },
    updatedAt: row.updatedAt,
  };
}

async function loadWebhookAutomationListPageItems(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  automationIds: readonly string[];
}): Promise<AutomationListPageItem[]> {
  if (input.automationIds.length === 0) {
    return [];
  }

  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      automationId: tables.automations.id,
      automationName: tables.automations.name,
      enabled: tables.automations.enabled,
      createdAt: tables.automations.createdAt,
      updatedAt: tables.automations.updatedAt,
      eventTypes: tables.webhookAutomations.eventTypes,
      integrationWebhookSourceId: tables.webhookAutomations.integrationWebhookSourceId,
      resolvedIntegrationWebhookSourceId: tables.integrationWebhookSources.id,
      resolvedIntegrationConnectionId: tables.integrationConnections.id,
      sandboxProfileId: tables.automationTargets.sandboxProfileId,
      sandboxProfileDisplayName: tables.sandboxProfiles.displayName,
      primaryRepositoryId: tables.automationTargets.primaryRepositoryId,
      integrationTargetFamilyId: tables.integrationTargets.familyId,
      integrationTargetVariantId: tables.integrationTargets.variantId,
      integrationTargetDisplayNameOverride: tables.integrationTargets.displayNameOverride,
      integrationTargetDescriptionOverride: tables.integrationTargets.descriptionOverride,
    })
    .from(tables.automations)
    .innerJoin(
      tables.webhookAutomations,
      eq(tables.webhookAutomations.automationId, tables.automations.id),
    )
    .leftJoin(
      tables.integrationWebhookSources,
      eq(tables.integrationWebhookSources.id, tables.webhookAutomations.integrationWebhookSourceId),
    )
    .leftJoin(
      tables.integrationConnections,
      eq(
        tables.integrationConnections.id,
        tables.integrationWebhookSources.integrationConnectionId,
      ),
    )
    .leftJoin(
      tables.integrationTargets,
      eq(tables.integrationTargets.targetKey, tables.integrationWebhookSources.targetKey),
    )
    .innerJoin(
      tables.automationTargets,
      eq(tables.automationTargets.automationId, tables.automations.id),
    )
    .leftJoin(
      tables.sandboxProfiles,
      eq(tables.sandboxProfiles.id, tables.automationTargets.sandboxProfileId),
    )
    .where(
      and(
        eq(tables.automations.organizationId, input.organizationId),
        eq(tables.automations.kind, AutomationKinds.WEBHOOK),
        inArray(tables.automations.id, input.automationIds),
      ),
    );

  const groupedRows = new Map<string, WebhookAutomationListPageRow[]>();

  for (const row of rows) {
    const automationRows = groupedRows.get(row.automationId);
    if (automationRows === undefined) {
      groupedRows.set(row.automationId, [row]);
      continue;
    }

    automationRows.push(row);
  }

  const rowsByAutomationId = new Map<string, AutomationListPageItem>();

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

    rowsByAutomationId.set(automationId, createWebhookAutomationListPageItem(automationRow));
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

type ScheduleAutomationListPageRow = {
  automationId: string;
  automationName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  sandboxProfileId: string;
  sandboxProfileDisplayName: string | null;
  primaryRepositoryId: string | null;
  cronExpression: string;
  timezone: string;
  nextScheduledAt: string | null;
};

async function loadScheduleAutomationListPageItems(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  automationIds: readonly string[];
}): Promise<AutomationListPageItem[]> {
  if (input.automationIds.length === 0) {
    return [];
  }

  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      automationId: tables.automations.id,
      automationName: tables.automations.name,
      enabled: tables.automations.enabled,
      createdAt: tables.automations.createdAt,
      updatedAt: tables.automations.updatedAt,
      sandboxProfileId: tables.automationTargets.sandboxProfileId,
      sandboxProfileDisplayName: tables.sandboxProfiles.displayName,
      primaryRepositoryId: tables.automationTargets.primaryRepositoryId,
      cronExpression: tables.schedules.cronExpression,
      timezone: tables.schedules.timezone,
      nextScheduledAt: tables.schedules.nextScheduledAt,
    })
    .from(tables.automations)
    .innerJoin(
      tables.scheduleAutomations,
      eq(tables.scheduleAutomations.automationId, tables.automations.id),
    )
    .innerJoin(tables.schedules, eq(tables.schedules.id, tables.scheduleAutomations.scheduleId))
    .innerJoin(
      tables.automationTargets,
      eq(tables.automationTargets.automationId, tables.automations.id),
    )
    .leftJoin(
      tables.sandboxProfiles,
      eq(tables.sandboxProfiles.id, tables.automationTargets.sandboxProfileId),
    )
    .where(
      and(
        eq(tables.automations.organizationId, input.organizationId),
        eq(tables.automations.kind, AutomationKinds.SCHEDULE),
        eq(tables.schedules.organizationId, input.organizationId),
        eq(tables.schedules.targetType, ScheduleTargetTypes.AUTOMATION_RUN),
        isNull(tables.schedules.deletedAt),
        inArray(tables.automations.id, input.automationIds),
      ),
    );

  const groupedRows = new Map<string, ScheduleAutomationListPageRow[]>();

  for (const row of rows) {
    const automationRows = groupedRows.get(row.automationId);
    if (automationRows === undefined) {
      groupedRows.set(row.automationId, [row]);
      continue;
    }

    automationRows.push(row);
  }

  const rowsByAutomationId = new Map<string, AutomationListPageItem>();

  for (const [automationId, automationRows] of groupedRows.entries()) {
    if (automationRows.length !== 1) {
      throw new Error(
        `Scheduled automation '${automationId}' must have exactly one automation target.`,
      );
    }

    const automationRow = automationRows[0];
    if (automationRow === undefined) {
      throw new Error(
        `Scheduled automation '${automationId}' could not be loaded for the list page.`,
      );
    }

    rowsByAutomationId.set(automationId, createScheduleAutomationListPageItem(automationRow));
  }

  return input.automationIds.map((automationId) => {
    const row = rowsByAutomationId.get(automationId);
    if (row === undefined) {
      throw new Error(
        `Scheduled automation '${automationId}' could not be loaded for the list page.`,
      );
    }

    return row;
  });
}

async function loadAutomationListPageItems(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  automations: readonly AutomationPageReference[];
}): Promise<AutomationListPageItem[]> {
  const webhookAutomationIds = input.automations
    .filter((automation) => automation.kind === AutomationKinds.WEBHOOK)
    .map((automation) => automation.id);
  const scheduleAutomationIds = input.automations
    .filter((automation) => automation.kind === AutomationKinds.SCHEDULE)
    .map((automation) => automation.id);

  const [webhookItems, scheduleItems] = await Promise.all([
    loadWebhookAutomationListPageItems({
      db: input.db,
      organizationId: input.organizationId,
      automationIds: webhookAutomationIds,
    }),
    loadScheduleAutomationListPageItems({
      db: input.db,
      organizationId: input.organizationId,
      automationIds: scheduleAutomationIds,
    }),
  ]);

  const itemsByAutomationId = new Map(
    [...webhookItems, ...scheduleItems].map((item) => [item.id, item]),
  );

  return input.automations.map((automation) => {
    const item = itemsByAutomationId.get(automation.id);
    if (item === undefined) {
      throw new Error(`Automation '${automation.id}' could not be loaded for the list page.`);
    }

    return item;
  });
}

function buildListableAutomationWhereClause(input: {
  tables: ControlPlaneTables;
  organizationId: string;
  sandboxProfileId?: string | undefined;
  cursor?: z.infer<typeof CursorSchema> | undefined;
  direction?: (typeof KeysetPaginationDirections)[keyof typeof KeysetPaginationDirections];
}) {
  const { tables } = input;
  const organizationScope = and(
    eq(tables.automations.organizationId, input.organizationId),
    or(
      eq(tables.automations.kind, AutomationKinds.WEBHOOK),
      and(
        eq(tables.automations.kind, AutomationKinds.SCHEDULE),
        isNotNull(tables.scheduleAutomations.scheduleId),
        isNotNull(tables.schedules.id),
        eq(tables.schedules.organizationId, input.organizationId),
        eq(tables.schedules.targetType, ScheduleTargetTypes.AUTOMATION_RUN),
        isNull(tables.schedules.deletedAt),
      ),
    ),
    input.sandboxProfileId === undefined
      ? undefined
      : eq(tables.automationTargets.sandboxProfileId, input.sandboxProfileId),
  );

  if (input.cursor === undefined || input.direction === undefined) {
    return organizationScope;
  }

  if (input.direction === KeysetPaginationDirections.FORWARD) {
    return and(
      organizationScope,
      or(
        lt(tables.automations.createdAt, input.cursor.createdAt),
        and(
          eq(tables.automations.createdAt, input.cursor.createdAt),
          lt(tables.automations.id, input.cursor.id),
        ),
      ),
    );
  }

  return and(
    organizationScope,
    or(
      gt(tables.automations.createdAt, input.cursor.createdAt),
      and(
        eq(tables.automations.createdAt, input.cursor.createdAt),
        gt(tables.automations.id, input.cursor.id),
      ),
    ),
  );
}

async function listAutomationPageReferences(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  sandboxProfileId?: string | undefined;
  limitPlusOne: number;
  cursor?: z.infer<typeof CursorSchema> | undefined;
  direction: (typeof KeysetPaginationDirections)[keyof typeof KeysetPaginationDirections];
}): Promise<AutomationPageReference[]> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  return input.db
    .select({
      id: tables.automations.id,
      kind: tables.automations.kind,
      createdAt: tables.automations.createdAt,
    })
    .from(tables.automations)
    .leftJoin(
      tables.scheduleAutomations,
      eq(tables.scheduleAutomations.automationId, tables.automations.id),
    )
    .leftJoin(tables.schedules, eq(tables.schedules.id, tables.scheduleAutomations.scheduleId))
    .innerJoin(
      tables.automationTargets,
      eq(tables.automationTargets.automationId, tables.automations.id),
    )
    .where(
      buildListableAutomationWhereClause({
        tables,
        organizationId: input.organizationId,
        sandboxProfileId: input.sandboxProfileId,
        cursor: input.cursor,
        direction: input.direction,
      }),
    )
    .orderBy(
      ...(input.direction === KeysetPaginationDirections.BACKWARD
        ? ascAutomationCreatedAt(tables)
        : descAutomationCreatedAt(tables)),
    )
    .limit(input.limitPlusOne);
}

function ascAutomationCreatedAt(tables: ControlPlaneTables) {
  return [sql`${tables.automations.createdAt} asc`, sql`${tables.automations.id} asc`];
}

function descAutomationCreatedAt(tables: ControlPlaneTables) {
  return [sql`${tables.automations.createdAt} desc`, sql`${tables.automations.id} desc`];
}

async function countListableAutomations(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  sandboxProfileId?: string | undefined;
}): Promise<number> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const [result] = await input.db
    .select({
      totalResults: sql<number>`count(*)::int`,
    })
    .from(tables.automations)
    .leftJoin(
      tables.scheduleAutomations,
      eq(tables.scheduleAutomations.automationId, tables.automations.id),
    )
    .leftJoin(tables.schedules, eq(tables.schedules.id, tables.scheduleAutomations.scheduleId))
    .innerJoin(
      tables.automationTargets,
      eq(tables.automationTargets.automationId, tables.automations.id),
    )
    .where(
      buildListableAutomationWhereClause({
        tables,
        organizationId: input.organizationId,
        sandboxProfileId: input.sandboxProfileId,
      }),
    );

  return result?.totalResults ?? 0;
}

export async function listAutomations(
  ctx: { db: ControlPlaneDatabase },
  input: ListAutomationsInput,
): Promise<KeysetPaginatedResult<AutomationListItem>> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PageSizeOptions);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        AutomationsBadRequestCodes.INVALID_LIST_AUTOMATIONS_INPUT,
        `\`limit\` must be an integer between 1 and ${String(MAX_PAGE_SIZE)}.`,
      );
    }

    throw error;
  }

  try {
    const result = await paginateKeyset<AutomationListPageItem, z.infer<typeof CursorSchema>>({
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
            };

            return new BadRequestError(
              AutomationsBadRequestCodes.INVALID_PAGINATION_CURSOR,
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
        const automationReferences = await listAutomationPageReferences({
          db: ctx.db,
          organizationId: input.organizationId,
          sandboxProfileId: input.sandboxProfileId,
          limitPlusOne,
          cursor,
          direction,
        });

        return loadAutomationListPageItems({
          db: ctx.db,
          organizationId: input.organizationId,
          automations: automationReferences,
        });
      },
      countTotalResults: async () =>
        countListableAutomations({
          db: ctx.db,
          organizationId: input.organizationId,
          sandboxProfileId: input.sandboxProfileId,
        }),
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
        AutomationsBadRequestCodes.INVALID_LIST_AUTOMATIONS_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}
