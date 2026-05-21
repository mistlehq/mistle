import {
  TriggerKinds,
  ScheduleKinds,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { TriggerKind, ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
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
import { listIntegrationDefinitions } from "@mistle/integrations-definitions/server";
import { and, eq, gt, ilike, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  hasTargetDefinition,
  resolveTargetMetadataFromPersistedTarget,
} from "../../integration-targets/services/resolve-target-metadata.js";
import { TriggersBadRequestCodes } from "../constants.js";

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

function parseOptionalBooleanQueryValue(value: unknown): unknown {
  if (value === undefined || typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return value;
}

export const ListTriggersQuerySchema = createKeysetPaginationQuerySchema(PageSizeOptions).extend({
  sandboxProfileId: z.string().min(1).optional(),
  kind: z.enum([TriggerKinds.WEBHOOK, TriggerKinds.SCHEDULE]).optional(),
  enabled: z.preprocess(parseOptionalBooleanQueryValue, z.boolean().optional()),
  search: z.string().trim().min(1).optional(),
});

export type ListTriggersInput = z.infer<typeof ListTriggersQuerySchema> & {
  organizationId: string;
};

export type GetTriggerInput = {
  organizationId: string;
  triggerId: string;
};

type TriggerListIssue = {
  code:
    | "MISSING_TARGET_METADATA"
    | "MISSING_WEBHOOK_SOURCE"
    | "MISSING_INTEGRATION_CONNECTION"
    | "MISSING_SANDBOX_PROFILE";
  message: string;
};

type TriggerListTarget = {
  sandboxProfileId: string;
  sandboxProfileName: string | null;
  sandboxProfileVersion: number;
  primaryRepositoryId: string | null;
  primaryRepositoryName: string | null;
};

type TriggerListWebhookEvent = {
  label: string;
  logoKey?: string;
  unavailable?: boolean;
};

export type TriggerListItem = {
  id: string;
  kind: TriggerKind;
  name: string;
  enabled: boolean;
  target: TriggerListTarget;
  issue?: TriggerListIssue;
  source:
    | {
        kind: "webhook";
        events: TriggerListWebhookEvent[];
      }
    | {
        kind: "schedule";
        cronExpression: string;
        timezone: string;
        nextScheduledAt: string | null;
      };
  updatedAt: string;
};

type TriggerListPageItem = TriggerListItem & {
  createdAt: string;
};

type TriggerPageReference = {
  id: string;
  kind: TriggerKind;
  createdAt: string;
};

type ControlPlaneTables = ReturnType<typeof getControlPlaneDatabaseSchema>;

const WebhookEventSearchRecords = listIntegrationDefinitions().flatMap((definition) =>
  (definition.supportedWebhookEvents ?? []).map((eventDefinition) => ({
    eventType: eventDefinition.eventType,
    searchableText: `${eventDefinition.eventType} ${eventDefinition.providerEventType} ${eventDefinition.displayName}`,
  })),
);

function normalizeTriggerSearchTerm(search: string | undefined): string | undefined {
  if (search === undefined) {
    return undefined;
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  return normalizedSearch.length === 0 ? undefined : normalizedSearch;
}

function toSqlLikePattern(search: string): string {
  return `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function resolveMatchingWebhookEventTypes(search: string): string[] {
  return [
    ...new Set(
      WebhookEventSearchRecords.filter((record) =>
        record.searchableText.toLocaleLowerCase().includes(search),
      ).map((record) => record.eventType),
    ),
  ];
}

function buildWebhookEventSearchClause(input: {
  tables: ControlPlaneTables;
  search: string;
  searchPattern: string;
}) {
  const matchingEventTypes = resolveMatchingWebhookEventTypes(input.search);
  return and(
    eq(input.tables.triggers.kind, TriggerKinds.WEBHOOK),
    or(
      ilike(sql`${input.tables.webhookTriggers.eventTypes}::text`, input.searchPattern),
      input.search === "all" || "all events".includes(input.search)
        ? isNull(input.tables.webhookTriggers.eventTypes)
        : undefined,
      matchingEventTypes.length === 0
        ? undefined
        : sql`${input.tables.webhookTriggers.eventTypes}::jsonb ?| array[${sql.join(
            matchingEventTypes.map((eventType) => sql`${eventType}`),
            sql`, `,
          )}]`,
    ),
  );
}

function buildTriggerSearchClause(input: {
  tables: ControlPlaneTables;
  search: string | undefined;
}) {
  const normalizedSearch = normalizeTriggerSearchTerm(input.search);
  if (normalizedSearch === undefined) {
    return undefined;
  }

  const { tables } = input;
  const searchPattern = toSqlLikePattern(normalizedSearch);

  return or(
    ilike(tables.triggers.name, searchPattern),
    ilike(tables.triggers.kind, searchPattern),
    normalizedSearch === "trigger" ||
      normalizedSearch === "triggers" ||
      normalizedSearch === "event" ||
      normalizedSearch === "events"
      ? eq(tables.triggers.kind, TriggerKinds.WEBHOOK)
      : undefined,
    normalizedSearch === "enabled" ? eq(tables.triggers.enabled, true) : undefined,
    normalizedSearch === "disabled" ? eq(tables.triggers.enabled, false) : undefined,
    ilike(tables.triggerTargets.sandboxProfileId, searchPattern),
    ilike(tables.sandboxProfiles.displayName, searchPattern),
    ilike(tables.triggerTargets.primaryRepositoryId, searchPattern),
    ilike(tables.schedules.cronExpression, searchPattern),
    ilike(tables.schedules.timezone, searchPattern),
    buildWebhookEventSearchClause({
      tables,
      search: normalizedSearch,
      searchPattern,
    }),
  );
}

function resolveTriggerListEvents(input: {
  eventTypes: string[] | null;
  supportedWebhookEvents?: {
    eventType: string;
    displayName: string;
  }[];
  logoKey?: string;
}): TriggerListWebhookEvent[] {
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

function resolveUnavailableTriggerListEvents(input: {
  eventTypes: string[] | null;
}): TriggerListWebhookEvent[] {
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
  sandboxProfileVersion: number;
  primaryRepositoryId: string | null;
}): TriggerListTarget {
  return {
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileName: input.sandboxProfileDisplayName,
    sandboxProfileVersion: input.sandboxProfileVersion,
    primaryRepositoryId: input.primaryRepositoryId,
    primaryRepositoryName: input.primaryRepositoryId,
  };
}

type WebhookTriggerListPageRow = {
  triggerId: string;
  triggerName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  eventTypes: string[] | null;
  integrationWebhookSourceId: string;
  resolvedIntegrationWebhookSourceId: string | null;
  resolvedIntegrationConnectionId: string | null;
  sandboxProfileId: string;
  sandboxProfileDisplayName: string | null;
  sandboxProfileVersion: number;
  primaryRepositoryId: string | null;
  integrationTargetFamilyId: string | null;
  integrationTargetVariantId: string | null;
  integrationTargetDisplayNameOverride: string | null;
  integrationTargetDescriptionOverride: string | null;
};

function createWebhookTriggerListPageItem(row: WebhookTriggerListPageRow): TriggerListPageItem {
  const target = createListTarget({
    sandboxProfileId: row.sandboxProfileId,
    sandboxProfileDisplayName: row.sandboxProfileDisplayName,
    sandboxProfileVersion: row.sandboxProfileVersion,
    primaryRepositoryId: row.primaryRepositoryId,
  });

  if (row.sandboxProfileDisplayName === null) {
    return {
      id: row.triggerId,
      kind: TriggerKinds.WEBHOOK,
      name: row.triggerName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_SANDBOX_PROFILE",
        message:
          "This trigger references a sandbox profile that is no longer available. The target name may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableTriggerListEvents({
          eventTypes: row.eventTypes,
        }),
      },
      updatedAt: row.updatedAt,
    };
  }

  if (row.resolvedIntegrationWebhookSourceId === null) {
    return {
      id: row.triggerId,
      kind: TriggerKinds.WEBHOOK,
      name: row.triggerName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_WEBHOOK_SOURCE",
        message:
          "This trigger references a webhook source that is no longer available. Event metadata may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableTriggerListEvents({
          eventTypes: row.eventTypes,
        }),
      },
      updatedAt: row.updatedAt,
    };
  }

  if (row.resolvedIntegrationConnectionId === null) {
    return {
      id: row.triggerId,
      kind: TriggerKinds.WEBHOOK,
      name: row.triggerName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_INTEGRATION_CONNECTION",
        message:
          "This trigger references an integration connection that is no longer available. Event metadata may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableTriggerListEvents({
          eventTypes: row.eventTypes,
        }),
      },
      updatedAt: row.updatedAt,
    };
  }

  if (row.integrationTargetFamilyId === null || row.integrationTargetVariantId === null) {
    return {
      id: row.triggerId,
      kind: TriggerKinds.WEBHOOK,
      name: row.triggerName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_TARGET_METADATA",
        message:
          "This trigger references an integration target definition that is no longer available. Event metadata may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableTriggerListEvents({
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
      id: row.triggerId,
      kind: TriggerKinds.WEBHOOK,
      name: row.triggerName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      target,
      issue: {
        code: "MISSING_TARGET_METADATA",
        message:
          "This trigger references an integration target definition that is no longer available. Event metadata may be incomplete.",
      },
      source: {
        kind: "webhook",
        events: resolveUnavailableTriggerListEvents({
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
    id: row.triggerId,
    kind: TriggerKinds.WEBHOOK,
    name: row.triggerName,
    enabled: row.enabled,
    createdAt: row.createdAt,
    target,
    source: {
      kind: "webhook",
      events: resolveTriggerListEvents({
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

function createScheduleTriggerListPageItem(row: ScheduleTriggerListPageRow): TriggerListPageItem {
  if (row.cronExpression === null) {
    throw new Error(`Recurring schedule trigger '${row.triggerId}' is missing cron_expression.`);
  }
  if (row.timezone === null) {
    throw new Error(`Recurring schedule trigger '${row.triggerId}' is missing timezone.`);
  }

  const target = createListTarget({
    sandboxProfileId: row.sandboxProfileId,
    sandboxProfileDisplayName: row.sandboxProfileDisplayName,
    sandboxProfileVersion: row.sandboxProfileVersion,
    primaryRepositoryId: row.primaryRepositoryId,
  });

  return {
    id: row.triggerId,
    kind: TriggerKinds.SCHEDULE,
    name: row.triggerName,
    enabled: row.enabled,
    createdAt: row.createdAt,
    target,
    ...(row.sandboxProfileDisplayName === null
      ? {
          issue: {
            code: "MISSING_SANDBOX_PROFILE",
            message:
              "This trigger references a sandbox profile that is no longer available. The target name may be incomplete.",
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

async function loadWebhookTriggerListPageItems(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  triggerIds: readonly string[];
}): Promise<TriggerListPageItem[]> {
  if (input.triggerIds.length === 0) {
    return [];
  }

  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      triggerId: tables.triggers.id,
      triggerName: tables.triggers.name,
      enabled: tables.triggers.enabled,
      createdAt: tables.triggers.createdAt,
      updatedAt: tables.triggers.updatedAt,
      eventTypes: tables.webhookTriggers.eventTypes,
      integrationWebhookSourceId: tables.webhookTriggers.integrationWebhookSourceId,
      resolvedIntegrationWebhookSourceId: tables.integrationWebhookSources.id,
      resolvedIntegrationConnectionId: tables.integrationConnections.id,
      sandboxProfileId: tables.triggerTargets.sandboxProfileId,
      sandboxProfileDisplayName: tables.sandboxProfiles.displayName,
      sandboxProfileVersion: tables.triggerTargets.sandboxProfileVersion,
      primaryRepositoryId: tables.triggerTargets.primaryRepositoryId,
      integrationTargetFamilyId: tables.integrationTargets.familyId,
      integrationTargetVariantId: tables.integrationTargets.variantId,
      integrationTargetDisplayNameOverride: tables.integrationTargets.displayNameOverride,
      integrationTargetDescriptionOverride: tables.integrationTargets.descriptionOverride,
    })
    .from(tables.triggers)
    .innerJoin(tables.webhookTriggers, eq(tables.webhookTriggers.triggerId, tables.triggers.id))
    .leftJoin(
      tables.integrationWebhookSources,
      eq(tables.integrationWebhookSources.id, tables.webhookTriggers.integrationWebhookSourceId),
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
    .innerJoin(tables.triggerTargets, eq(tables.triggerTargets.triggerId, tables.triggers.id))
    .leftJoin(
      tables.sandboxProfiles,
      eq(tables.sandboxProfiles.id, tables.triggerTargets.sandboxProfileId),
    )
    .where(
      and(
        eq(tables.triggers.organizationId, input.organizationId),
        eq(tables.triggers.kind, TriggerKinds.WEBHOOK),
        inArray(tables.triggers.id, input.triggerIds),
      ),
    );

  const groupedRows = new Map<string, WebhookTriggerListPageRow[]>();

  for (const row of rows) {
    const triggerRows = groupedRows.get(row.triggerId);
    if (triggerRows === undefined) {
      groupedRows.set(row.triggerId, [row]);
      continue;
    }

    triggerRows.push(row);
  }

  const rowsByTriggerId = new Map<string, TriggerListPageItem>();

  for (const [triggerId, triggerRows] of groupedRows.entries()) {
    if (triggerRows.length !== 1) {
      throw new Error(`Webhook trigger '${triggerId}' must have exactly one trigger target.`);
    }

    const triggerRow = triggerRows[0];
    if (triggerRow === undefined) {
      throw new Error(`Webhook trigger '${triggerId}' could not be loaded for the list page.`);
    }

    rowsByTriggerId.set(triggerId, createWebhookTriggerListPageItem(triggerRow));
  }

  return input.triggerIds.map((triggerId) => {
    const row = rowsByTriggerId.get(triggerId);
    if (row === undefined) {
      throw new Error(`Webhook trigger '${triggerId}' could not be loaded for the list page.`);
    }

    return row;
  });
}

type ScheduleTriggerListPageRow = {
  triggerId: string;
  triggerName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  sandboxProfileId: string;
  sandboxProfileDisplayName: string | null;
  sandboxProfileVersion: number;
  primaryRepositoryId: string | null;
  cronExpression: string | null;
  timezone: string | null;
  nextScheduledAt: string | null;
};

async function loadScheduleTriggerListPageItems(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  triggerIds: readonly string[];
}): Promise<TriggerListPageItem[]> {
  if (input.triggerIds.length === 0) {
    return [];
  }

  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      triggerId: tables.triggers.id,
      triggerName: tables.triggers.name,
      enabled: tables.triggers.enabled,
      createdAt: tables.triggers.createdAt,
      updatedAt: tables.triggers.updatedAt,
      sandboxProfileId: tables.triggerTargets.sandboxProfileId,
      sandboxProfileDisplayName: tables.sandboxProfiles.displayName,
      sandboxProfileVersion: tables.triggerTargets.sandboxProfileVersion,
      primaryRepositoryId: tables.triggerTargets.primaryRepositoryId,
      cronExpression: tables.schedules.cronExpression,
      timezone: tables.schedules.timezone,
      nextScheduledAt: tables.schedules.nextScheduledAt,
    })
    .from(tables.triggers)
    .innerJoin(tables.scheduleTriggers, eq(tables.scheduleTriggers.triggerId, tables.triggers.id))
    .innerJoin(tables.schedules, eq(tables.schedules.id, tables.scheduleTriggers.scheduleId))
    .innerJoin(tables.triggerTargets, eq(tables.triggerTargets.triggerId, tables.triggers.id))
    .leftJoin(
      tables.sandboxProfiles,
      eq(tables.sandboxProfiles.id, tables.triggerTargets.sandboxProfileId),
    )
    .where(
      and(
        eq(tables.triggers.organizationId, input.organizationId),
        eq(tables.triggers.kind, TriggerKinds.SCHEDULE),
        eq(tables.schedules.organizationId, input.organizationId),
        eq(tables.schedules.kind, ScheduleKinds.RECURRING),
        eq(tables.schedules.targetType, ScheduleTargetTypes.TRIGGER_RUN),
        isNull(tables.schedules.deletedAt),
        inArray(tables.triggers.id, input.triggerIds),
      ),
    );

  const groupedRows = new Map<string, ScheduleTriggerListPageRow[]>();

  for (const row of rows) {
    const triggerRows = groupedRows.get(row.triggerId);
    if (triggerRows === undefined) {
      groupedRows.set(row.triggerId, [row]);
      continue;
    }

    triggerRows.push(row);
  }

  const rowsByTriggerId = new Map<string, TriggerListPageItem>();

  for (const [triggerId, triggerRows] of groupedRows.entries()) {
    if (triggerRows.length !== 1) {
      throw new Error(`Scheduled trigger '${triggerId}' must have exactly one trigger target.`);
    }

    const triggerRow = triggerRows[0];
    if (triggerRow === undefined) {
      throw new Error(`Scheduled trigger '${triggerId}' could not be loaded for the list page.`);
    }
    if (triggerRow.cronExpression === null) {
      throw new Error(`Recurring schedule trigger '${triggerId}' is missing cron_expression.`);
    }
    if (triggerRow.timezone === null) {
      throw new Error(`Recurring schedule trigger '${triggerId}' is missing timezone.`);
    }

    rowsByTriggerId.set(triggerId, createScheduleTriggerListPageItem(triggerRow));
  }

  return input.triggerIds.map((triggerId) => {
    const row = rowsByTriggerId.get(triggerId);
    if (row === undefined) {
      throw new Error(`Scheduled trigger '${triggerId}' could not be loaded for the list page.`);
    }

    return row;
  });
}

async function loadTriggerListPageItems(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  triggers: readonly TriggerPageReference[];
}): Promise<TriggerListPageItem[]> {
  const webhookTriggerIds = input.triggers
    .filter((trigger) => trigger.kind === TriggerKinds.WEBHOOK)
    .map((trigger) => trigger.id);
  const scheduleTriggerIds = input.triggers
    .filter((trigger) => trigger.kind === TriggerKinds.SCHEDULE)
    .map((trigger) => trigger.id);

  const [webhookItems, scheduleItems] = await Promise.all([
    loadWebhookTriggerListPageItems({
      db: input.db,
      organizationId: input.organizationId,
      triggerIds: webhookTriggerIds,
    }),
    loadScheduleTriggerListPageItems({
      db: input.db,
      organizationId: input.organizationId,
      triggerIds: scheduleTriggerIds,
    }),
  ]);

  const itemsByTriggerId = new Map(
    [...webhookItems, ...scheduleItems].map((item) => [item.id, item]),
  );

  return input.triggers.map((trigger) => {
    const item = itemsByTriggerId.get(trigger.id);
    if (item === undefined) {
      throw new Error(`Trigger '${trigger.id}' could not be loaded for the list page.`);
    }

    return item;
  });
}

function buildListableTriggerWhereClause(input: {
  tables: ControlPlaneTables;
  organizationId: string;
  triggerId?: string | undefined;
  sandboxProfileId?: string | undefined;
  kind?: TriggerKind | undefined;
  enabled?: boolean | undefined;
  search?: string | undefined;
  cursor?: z.infer<typeof CursorSchema> | undefined;
  direction?: (typeof KeysetPaginationDirections)[keyof typeof KeysetPaginationDirections];
}) {
  const { tables } = input;
  const organizationScope = and(
    eq(tables.triggers.organizationId, input.organizationId),
    input.triggerId === undefined ? undefined : eq(tables.triggers.id, input.triggerId),
    or(
      eq(tables.triggers.kind, TriggerKinds.WEBHOOK),
      and(
        eq(tables.triggers.kind, TriggerKinds.SCHEDULE),
        isNotNull(tables.scheduleTriggers.scheduleId),
        isNotNull(tables.schedules.id),
        eq(tables.schedules.organizationId, input.organizationId),
        eq(tables.schedules.kind, ScheduleKinds.RECURRING),
        eq(tables.schedules.targetType, ScheduleTargetTypes.TRIGGER_RUN),
        isNull(tables.schedules.deletedAt),
      ),
    ),
    input.sandboxProfileId === undefined
      ? undefined
      : eq(tables.triggerTargets.sandboxProfileId, input.sandboxProfileId),
    input.kind === undefined ? undefined : eq(tables.triggers.kind, input.kind),
    input.enabled === undefined ? undefined : eq(tables.triggers.enabled, input.enabled),
    buildTriggerSearchClause({ tables, search: input.search }),
  );

  if (input.cursor === undefined || input.direction === undefined) {
    return organizationScope;
  }

  if (input.direction === KeysetPaginationDirections.FORWARD) {
    return and(
      organizationScope,
      or(
        lt(tables.triggers.createdAt, input.cursor.createdAt),
        and(
          eq(tables.triggers.createdAt, input.cursor.createdAt),
          lt(tables.triggers.id, input.cursor.id),
        ),
      ),
    );
  }

  return and(
    organizationScope,
    or(
      gt(tables.triggers.createdAt, input.cursor.createdAt),
      and(
        eq(tables.triggers.createdAt, input.cursor.createdAt),
        gt(tables.triggers.id, input.cursor.id),
      ),
    ),
  );
}

async function listTriggerPageReferences(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  triggerId?: string | undefined;
  sandboxProfileId?: string | undefined;
  kind?: TriggerKind | undefined;
  enabled?: boolean | undefined;
  search?: string | undefined;
  limitPlusOne: number;
  cursor?: z.infer<typeof CursorSchema> | undefined;
  direction: (typeof KeysetPaginationDirections)[keyof typeof KeysetPaginationDirections];
}): Promise<TriggerPageReference[]> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  return input.db
    .select({
      id: tables.triggers.id,
      kind: tables.triggers.kind,
      createdAt: tables.triggers.createdAt,
    })
    .from(tables.triggers)
    .leftJoin(tables.scheduleTriggers, eq(tables.scheduleTriggers.triggerId, tables.triggers.id))
    .leftJoin(tables.schedules, eq(tables.schedules.id, tables.scheduleTriggers.scheduleId))
    .innerJoin(tables.triggerTargets, eq(tables.triggerTargets.triggerId, tables.triggers.id))
    .leftJoin(tables.webhookTriggers, eq(tables.webhookTriggers.triggerId, tables.triggers.id))
    .leftJoin(
      tables.sandboxProfiles,
      eq(tables.sandboxProfiles.id, tables.triggerTargets.sandboxProfileId),
    )
    .where(
      buildListableTriggerWhereClause({
        tables,
        organizationId: input.organizationId,
        triggerId: input.triggerId,
        sandboxProfileId: input.sandboxProfileId,
        kind: input.kind,
        enabled: input.enabled,
        search: input.search,
        cursor: input.cursor,
        direction: input.direction,
      }),
    )
    .orderBy(
      ...(input.direction === KeysetPaginationDirections.BACKWARD
        ? ascTriggerCreatedAt(tables)
        : descTriggerCreatedAt(tables)),
    )
    .limit(input.limitPlusOne);
}

function ascTriggerCreatedAt(tables: ControlPlaneTables) {
  return [sql`${tables.triggers.createdAt} asc`, sql`${tables.triggers.id} asc`];
}

function descTriggerCreatedAt(tables: ControlPlaneTables) {
  return [sql`${tables.triggers.createdAt} desc`, sql`${tables.triggers.id} desc`];
}

async function countListableTriggers(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  sandboxProfileId?: string | undefined;
  kind?: TriggerKind | undefined;
  enabled?: boolean | undefined;
  search?: string | undefined;
}): Promise<number> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const [result] = await input.db
    .select({
      totalResults: sql<number>`count(*)::int`,
    })
    .from(tables.triggers)
    .leftJoin(tables.scheduleTriggers, eq(tables.scheduleTriggers.triggerId, tables.triggers.id))
    .leftJoin(tables.schedules, eq(tables.schedules.id, tables.scheduleTriggers.scheduleId))
    .innerJoin(tables.triggerTargets, eq(tables.triggerTargets.triggerId, tables.triggers.id))
    .leftJoin(tables.webhookTriggers, eq(tables.webhookTriggers.triggerId, tables.triggers.id))
    .leftJoin(
      tables.sandboxProfiles,
      eq(tables.sandboxProfiles.id, tables.triggerTargets.sandboxProfileId),
    )
    .where(
      buildListableTriggerWhereClause({
        tables,
        organizationId: input.organizationId,
        sandboxProfileId: input.sandboxProfileId,
        kind: input.kind,
        enabled: input.enabled,
        search: input.search,
      }),
    );

  return result?.totalResults ?? 0;
}

export async function listTriggers(
  ctx: { db: ControlPlaneDatabase },
  input: ListTriggersInput,
): Promise<KeysetPaginatedResult<TriggerListItem>> {
  let pageSize: number;

  try {
    pageSize = parseKeysetPageSize(input.limit, PageSizeOptions);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        TriggersBadRequestCodes.INVALID_LIST_TRIGGERS_INPUT,
        `\`limit\` must be an integer between 1 and ${String(MAX_PAGE_SIZE)}.`,
      );
    }

    throw error;
  }

  try {
    const result = await paginateKeyset<TriggerListPageItem, z.infer<typeof CursorSchema>>({
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
              TriggersBadRequestCodes.INVALID_PAGINATION_CURSOR,
              reasonToMessage[reason],
            );
          },
        }),
      encodeCursor: encodeKeysetCursor,
      getCursor: (trigger) => ({
        createdAt: trigger.createdAt,
        id: trigger.id,
      }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) => {
        const triggerReferences = await listTriggerPageReferences({
          db: ctx.db,
          organizationId: input.organizationId,
          sandboxProfileId: input.sandboxProfileId,
          kind: input.kind,
          enabled: input.enabled,
          search: input.search,
          limitPlusOne,
          cursor,
          direction,
        });

        return loadTriggerListPageItems({
          db: ctx.db,
          organizationId: input.organizationId,
          triggers: triggerReferences,
        });
      },
      countTotalResults: async () =>
        countListableTriggers({
          db: ctx.db,
          organizationId: input.organizationId,
          sandboxProfileId: input.sandboxProfileId,
          kind: input.kind,
          enabled: input.enabled,
          search: input.search,
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
        TriggersBadRequestCodes.INVALID_LIST_TRIGGERS_INPUT,
        "Only one of `after` or `before` can be provided.",
      );
    }

    throw error;
  }
}

export async function getTrigger(
  ctx: { db: ControlPlaneDatabase },
  input: GetTriggerInput,
): Promise<TriggerListItem> {
  const [triggerReference] = await listTriggerPageReferences({
    db: ctx.db,
    organizationId: input.organizationId,
    triggerId: input.triggerId,
    direction: KeysetPaginationDirections.FORWARD,
    limitPlusOne: 1,
  });

  if (triggerReference === undefined) {
    throw new NotFoundError("NOT_FOUND", "Trigger was not found.");
  }

  const [trigger] = await loadTriggerListPageItems({
    db: ctx.db,
    organizationId: input.organizationId,
    triggers: [triggerReference],
  });

  if (trigger === undefined) {
    throw new Error(`Trigger '${input.triggerId}' could not be loaded.`);
  }

  const { createdAt: _createdAt, ...item } = trigger;
  return item;
}
