import {
  automations,
  automationTargets,
  AutomationKinds,
  integrationConnections,
  integrationTargets,
  integrationWebhookSources,
  sandboxProfiles,
  scheduleAutomations,
  schedules,
  ScheduleTargetTypes,
  webhookAutomations,
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
});

export type ListAutomationsInput = {
  organizationId: string;
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
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

  const rows = await input.db
    .select({
      automationId: automations.id,
      automationName: automations.name,
      enabled: automations.enabled,
      createdAt: automations.createdAt,
      updatedAt: automations.updatedAt,
      eventTypes: webhookAutomations.eventTypes,
      integrationWebhookSourceId: webhookAutomations.integrationWebhookSourceId,
      resolvedIntegrationWebhookSourceId: integrationWebhookSources.id,
      resolvedIntegrationConnectionId: integrationConnections.id,
      sandboxProfileId: automationTargets.sandboxProfileId,
      sandboxProfileDisplayName: sandboxProfiles.displayName,
      primaryRepositoryId: automationTargets.primaryRepositoryId,
      integrationTargetFamilyId: integrationTargets.familyId,
      integrationTargetVariantId: integrationTargets.variantId,
      integrationTargetDisplayNameOverride: integrationTargets.displayNameOverride,
      integrationTargetDescriptionOverride: integrationTargets.descriptionOverride,
    })
    .from(automations)
    .innerJoin(webhookAutomations, eq(webhookAutomations.automationId, automations.id))
    .leftJoin(
      integrationWebhookSources,
      eq(integrationWebhookSources.id, webhookAutomations.integrationWebhookSourceId),
    )
    .leftJoin(
      integrationConnections,
      eq(integrationConnections.id, integrationWebhookSources.integrationConnectionId),
    )
    .leftJoin(
      integrationTargets,
      eq(integrationTargets.targetKey, integrationWebhookSources.targetKey),
    )
    .innerJoin(automationTargets, eq(automationTargets.automationId, automations.id))
    .leftJoin(sandboxProfiles, eq(sandboxProfiles.id, automationTargets.sandboxProfileId))
    .where(
      and(
        eq(automations.organizationId, input.organizationId),
        eq(automations.kind, AutomationKinds.WEBHOOK),
        inArray(automations.id, input.automationIds),
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

  const rows = await input.db
    .select({
      automationId: automations.id,
      automationName: automations.name,
      enabled: automations.enabled,
      createdAt: automations.createdAt,
      updatedAt: automations.updatedAt,
      sandboxProfileId: automationTargets.sandboxProfileId,
      sandboxProfileDisplayName: sandboxProfiles.displayName,
      primaryRepositoryId: automationTargets.primaryRepositoryId,
      cronExpression: schedules.cronExpression,
      timezone: schedules.timezone,
      nextScheduledAt: schedules.nextScheduledAt,
    })
    .from(automations)
    .innerJoin(scheduleAutomations, eq(scheduleAutomations.automationId, automations.id))
    .innerJoin(schedules, eq(schedules.id, scheduleAutomations.scheduleId))
    .innerJoin(automationTargets, eq(automationTargets.automationId, automations.id))
    .leftJoin(sandboxProfiles, eq(sandboxProfiles.id, automationTargets.sandboxProfileId))
    .where(
      and(
        eq(automations.organizationId, input.organizationId),
        eq(automations.kind, AutomationKinds.SCHEDULE),
        eq(schedules.organizationId, input.organizationId),
        eq(schedules.targetType, ScheduleTargetTypes.AUTOMATION_RUN),
        isNull(schedules.deletedAt),
        inArray(automations.id, input.automationIds),
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
  organizationId: string;
  cursor?: z.infer<typeof CursorSchema> | undefined;
  direction?: (typeof KeysetPaginationDirections)[keyof typeof KeysetPaginationDirections];
}) {
  const organizationScope = and(
    eq(automations.organizationId, input.organizationId),
    or(
      eq(automations.kind, AutomationKinds.WEBHOOK),
      and(
        eq(automations.kind, AutomationKinds.SCHEDULE),
        isNotNull(scheduleAutomations.scheduleId),
        isNotNull(schedules.id),
        eq(schedules.organizationId, input.organizationId),
        eq(schedules.targetType, ScheduleTargetTypes.AUTOMATION_RUN),
        isNull(schedules.deletedAt),
      ),
    ),
  );

  if (input.cursor === undefined || input.direction === undefined) {
    return organizationScope;
  }

  if (input.direction === KeysetPaginationDirections.FORWARD) {
    return and(
      organizationScope,
      or(
        lt(automations.createdAt, input.cursor.createdAt),
        and(eq(automations.createdAt, input.cursor.createdAt), lt(automations.id, input.cursor.id)),
      ),
    );
  }

  return and(
    organizationScope,
    or(
      gt(automations.createdAt, input.cursor.createdAt),
      and(eq(automations.createdAt, input.cursor.createdAt), gt(automations.id, input.cursor.id)),
    ),
  );
}

async function listAutomationPageReferences(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  limitPlusOne: number;
  cursor?: z.infer<typeof CursorSchema> | undefined;
  direction: (typeof KeysetPaginationDirections)[keyof typeof KeysetPaginationDirections];
}): Promise<AutomationPageReference[]> {
  return input.db
    .select({
      id: automations.id,
      kind: automations.kind,
      createdAt: automations.createdAt,
    })
    .from(automations)
    .leftJoin(scheduleAutomations, eq(scheduleAutomations.automationId, automations.id))
    .leftJoin(schedules, eq(schedules.id, scheduleAutomations.scheduleId))
    .where(
      buildListableAutomationWhereClause({
        organizationId: input.organizationId,
        cursor: input.cursor,
        direction: input.direction,
      }),
    )
    .orderBy(
      ...(input.direction === KeysetPaginationDirections.BACKWARD
        ? ascAutomationCreatedAt()
        : descAutomationCreatedAt()),
    )
    .limit(input.limitPlusOne);
}

function ascAutomationCreatedAt() {
  return [sql`${automations.createdAt} asc`, sql`${automations.id} asc`];
}

function descAutomationCreatedAt() {
  return [sql`${automations.createdAt} desc`, sql`${automations.id} desc`];
}

async function countListableAutomations(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
}): Promise<number> {
  const [result] = await input.db
    .select({
      totalResults: sql<number>`count(*)::int`,
    })
    .from(automations)
    .leftJoin(scheduleAutomations, eq(scheduleAutomations.automationId, automations.id))
    .leftJoin(schedules, eq(schedules.id, scheduleAutomations.scheduleId))
    .where(buildListableAutomationWhereClause({ organizationId: input.organizationId }));

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
