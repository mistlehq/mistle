import {
  IntegrationConnectionStatuses,
  IntegrationWebhookSourceStatuses,
  TriggerKinds,
} from "@mistle/db/control-plane";
import { BadRequestError, ForbiddenError, NotFoundError } from "@mistle/http/errors.js";
import {
  isWebhookTriggerSupportedByCapabilities,
  parseWebhookTriggerCapabilitiesProviderMetadata,
} from "@mistle/integrations-core";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import {
  OrganizationPermissions,
  hasTriggerCreatePermission,
  hasTriggerReadPermission,
  hasTriggerUpdatePermission,
} from "../../auth/services/organization-policy.js";
import { resolveTargetMetadataFromPersistedTarget } from "../../integration-targets/services/resolve-target-metadata.js";
import { createTriggerSchedule } from "../../trigger-schedules/services/create-trigger-schedule.js";
import { loadScheduleTriggerAggregateOrThrow } from "../../trigger-schedules/services/load-schedule-trigger-aggregate-or-throw.js";
import type { TriggerScheduleAggregate } from "../../trigger-schedules/services/load-schedule-trigger-aggregate-or-throw.js";
import { updateTriggerSchedule } from "../../trigger-schedules/services/update-trigger-schedule.js";
import { createTriggerWebhook } from "../../trigger-webhooks/services/create-trigger-webhook.js";
import { loadWebhookTriggerAggregateOrThrow } from "../../trigger-webhooks/services/load-webhook-trigger-aggregate-or-throw.js";
import type { TriggerWebhookAggregate } from "../../trigger-webhooks/services/load-webhook-trigger-aggregate-or-throw.js";
import { updateTriggerWebhook } from "../../trigger-webhooks/services/update-trigger-webhook.js";
import {
  listTriggers,
  ListTriggersQuerySchema,
} from "../../triggers/services/trigger-summaries.js";
import type { MistleMcpServerContext } from "../server.js";
import {
  mcpCreateTriggerInputSchema,
  mcpListTriggerWebhookEventsInputSchema,
  mcpListTriggersInputSchema,
  mcpTriggerIdParamsSchema,
  mcpUpdateTriggerInputSchema,
  type McpUpdateTriggerInput,
} from "../tool-schemas.js";
import { requireMcpToolPermission, structuredResult } from "./shared.js";

const ReadOnlyToolAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const MutatingToolAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function registerTriggerTools(server: McpServer, context: MistleMcpServerContext): void {
  server.registerTool(
    "list_triggers",
    {
      title: "List triggers",
      description:
        "List Mistle triggers in the current organization. A trigger automatically starts a sandbox session for a sandbox profile when a webhook event or schedule occurs.",
      inputSchema: mcpListTriggersInputSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List triggers",
      },
    },
    async (input) => {
      requireMcpTriggerReadPermission(context);
      const query = ListTriggersQuerySchema.parse(input);

      const result = await listTriggers(
        {
          db: context.db,
        },
        {
          ...query,
          organizationId: context.organizationActor.organizationId,
        },
      );

      return structuredResult(result);
    },
  );

  server.registerTool(
    "list_trigger_webhook_events",
    {
      title: "List trigger webhook events",
      description:
        "List webhook events that can be selected for Mistle webhook triggers targeting a sandbox profile. Results are scoped to the profile's active integration bindings and include the webhook source ID and event type needed when choosing trigger events.",
      inputSchema: mcpListTriggerWebhookEventsInputSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List trigger webhook events",
      },
    },
    async ({ sandboxProfileId }) => {
      requireMcpTriggerReadPermission(context);

      return structuredResult(
        await listTriggerWebhookEventsForProfile(context, {
          sandboxProfileId,
        }),
      );
    },
  );

  server.registerTool(
    "get_trigger",
    {
      title: "Get a trigger",
      description:
        "Get one Mistle trigger by ID as full trigger configuration. The response is kind-discriminated and includes the durable behavior fields needed for read-modify-write updates.",
      inputSchema: mcpTriggerIdParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get a trigger",
      },
    },
    async ({ triggerId }) => {
      requireMcpTriggerReadPermission(context);
      return structuredResult(await getMcpTriggerConfiguration(context, triggerId));
    },
  );

  server.registerTool(
    "create_trigger",
    {
      title: "Create trigger",
      description:
        "Create a Mistle trigger from full trigger configuration. Use kind='webhook' for webhook triggers and kind='schedule' for recurring or one-off scheduled triggers.",
      inputSchema: mcpCreateTriggerInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        idempotentHint: false,
        title: "Create trigger",
      },
    },
    async (input) => {
      if (input.kind === TriggerKinds.WEBHOOK) {
        requireMcpTriggerCreatePermission(context);
        const created = await createTriggerWebhook(
          {
            db: context.db,
            integrationRegistry: context.integrationRegistry,
          },
          {
            organizationId: context.organizationActor.organizationId,
            name: input.name,
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            integrationWebhookSourceId: input.integrationWebhookSourceId,
            eventConditions: input.eventConditions,
            inputTemplate: input.inputTemplate,
            ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
            conversationKeyTemplate: input.conversationKeyTemplate,
            ...(input.idempotencyKeyTemplate === undefined
              ? {}
              : { idempotencyKeyTemplate: input.idempotencyKeyTemplate }),
            target: input.target,
          },
        );

        return structuredResult(toMcpWebhookTriggerConfiguration(created));
      }

      requireMcpToolPermission(context.organizationActor, OrganizationPermissions.TRIGGER_CREATE);
      const created = await createTriggerSchedule(
        {
          db: context.db,
          openWorkflow: context.openWorkflow,
        },
        {
          organizationId: context.organizationActor.organizationId,
          name: input.name,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          schedule: input.schedule,
          inputTemplate: input.inputTemplate,
          ...(input.conversationKeyTemplate === undefined
            ? {}
            : { conversationKeyTemplate: input.conversationKeyTemplate }),
          ...(input.idempotencyKeyTemplate === undefined
            ? {}
            : { idempotencyKeyTemplate: input.idempotencyKeyTemplate }),
          target: input.target,
          now: context.clock.nowDate(),
        },
      );

      return structuredResult(toMcpScheduleTriggerConfiguration(created));
    },
  );

  server.registerTool(
    "update_trigger",
    {
      title: "Update trigger",
      description:
        "Partially update one Mistle trigger using full trigger configuration fields. Omitted fields are preserved; explicit null clears nullable fields.",
      inputSchema: mcpUpdateTriggerInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        idempotentHint: false,
        title: "Update trigger",
      },
    },
    async (input) => {
      if (input.kind === TriggerKinds.WEBHOOK) {
        requireMcpTriggerUpdatePermission(context);
        assertHasTriggerUpdateField(input);
        const updated = await updateTriggerWebhook(
          {
            db: context.db,
            integrationRegistry: context.integrationRegistry,
          },
          {
            organizationId: context.organizationActor.organizationId,
            triggerId: input.triggerId,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            ...(input.integrationWebhookSourceId === undefined
              ? {}
              : { integrationWebhookSourceId: input.integrationWebhookSourceId }),
            ...(input.eventConditions === undefined
              ? {}
              : { eventConditions: input.eventConditions }),
            ...(input.inputTemplate === undefined ? {} : { inputTemplate: input.inputTemplate }),
            ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
            ...(input.conversationKeyTemplate === undefined
              ? {}
              : { conversationKeyTemplate: input.conversationKeyTemplate }),
            ...(input.idempotencyKeyTemplate === undefined
              ? {}
              : { idempotencyKeyTemplate: input.idempotencyKeyTemplate }),
            ...(input.target === undefined ? {} : { target: input.target }),
          },
        );

        return structuredResult(toMcpWebhookTriggerConfiguration(updated));
      }

      requireMcpToolPermission(context.organizationActor, OrganizationPermissions.TRIGGER_UPDATE);
      assertHasTriggerUpdateField(input);
      const updated = await updateTriggerSchedule(
        {
          db: context.db,
          openWorkflow: context.openWorkflow,
        },
        {
          organizationId: context.organizationActor.organizationId,
          triggerId: input.triggerId,
          now: context.clock.nowDate(),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
          ...(input.inputTemplate === undefined ? {} : { inputTemplate: input.inputTemplate }),
          ...(input.conversationKeyTemplate === undefined
            ? {}
            : { conversationKeyTemplate: input.conversationKeyTemplate }),
          ...(input.idempotencyKeyTemplate === undefined
            ? {}
            : { idempotencyKeyTemplate: input.idempotencyKeyTemplate }),
          ...(input.target === undefined ? {} : { target: input.target }),
        },
      );

      return structuredResult(toMcpScheduleTriggerConfiguration(updated));
    },
  );
}

function requireMcpTriggerReadPermission(context: MistleMcpServerContext): void {
  if (hasTriggerReadPermission(context.organizationActor.permissions)) {
    return;
  }

  throw new ForbiddenError("FORBIDDEN", "Missing required MCP permission: trigger:read.");
}

function requireMcpTriggerCreatePermission(context: MistleMcpServerContext): void {
  if (hasTriggerCreatePermission(context.organizationActor.permissions)) {
    return;
  }

  throw new ForbiddenError("FORBIDDEN", "Missing required MCP permission: trigger:create.");
}

function requireMcpTriggerUpdatePermission(context: MistleMcpServerContext): void {
  if (hasTriggerUpdatePermission(context.organizationActor.permissions)) {
    return;
  }

  throw new ForbiddenError("FORBIDDEN", "Missing required MCP permission: trigger:update.");
}

async function listTriggerWebhookEventsForProfile(
  context: MistleMcpServerContext,
  input: {
    sandboxProfileId: string;
  },
) {
  const profile = await context.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
      displayName: true,
      activeVersion: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sandboxProfileId),
        whereEq(table.organizationId, context.organizationActor.organizationId),
      ),
  });

  if (profile === undefined) {
    throw new NotFoundError("NOT_FOUND", "Sandbox profile was not found.");
  }

  if (profile.activeVersion === null) {
    throw new BadRequestError(
      "SANDBOX_PROFILE_HAS_NO_ACTIVE_VERSION",
      "Sandbox profile does not have an active version.",
    );
  }
  const activeVersion = profile.activeVersion;

  const bindings = await context.db.query.sandboxProfileVersionIntegrationBindings.findMany({
    columns: {
      connectionId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, profile.id),
        whereEq(table.sandboxProfileVersion, activeVersion),
      ),
  });
  const boundConnectionIds = new Set(bindings.map((binding) => binding.connectionId));

  const connections = await context.db.query.integrationConnections.findMany({
    columns: {
      id: true,
      targetKey: true,
      displayName: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.organizationId, context.organizationActor.organizationId),
        whereEq(table.status, IntegrationConnectionStatuses.ACTIVE),
      ),
    with: {
      target: {
        columns: {
          targetKey: true,
          enabled: true,
          familyId: true,
          variantId: true,
          displayNameOverride: true,
          descriptionOverride: true,
        },
      },
    },
  });
  const activeBoundConnections = connections.filter(
    (connection) => boundConnectionIds.has(connection.id) && connection.target?.enabled === true,
  );

  const webhookSources = await context.db.query.integrationWebhookSources.findMany({
    columns: {
      id: true,
      integrationConnectionId: true,
      targetKey: true,
      displayName: true,
      providerMetadata: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.organizationId, context.organizationActor.organizationId),
        whereEq(table.status, IntegrationWebhookSourceStatuses.ACTIVE),
      ),
  });
  const activeWebhookSourcesByConnectionId = new Map<string, typeof webhookSources>();

  for (const source of webhookSources) {
    const existingSources = activeWebhookSourcesByConnectionId.get(source.integrationConnectionId);
    if (existingSources === undefined) {
      activeWebhookSourcesByConnectionId.set(source.integrationConnectionId, [source]);
    } else {
      existingSources.push(source);
    }
  }

  const events = activeBoundConnections.flatMap((connection) => {
    const target = connection.target;
    if (target === null) {
      throw new Error(`Integration connection '${connection.id}' is missing target.`);
    }

    const metadata = resolveTargetMetadataFromPersistedTarget(target);
    const supportedWebhookEvents = metadata.supportedWebhookEvents ?? [];
    const connectionSources = activeWebhookSourcesByConnectionId.get(connection.id) ?? [];

    return connectionSources.flatMap((source) => {
      const capabilities = parseWebhookTriggerCapabilitiesProviderMetadata(source.providerMetadata);

      return supportedWebhookEvents
        .filter((eventDefinition) =>
          isWebhookTriggerSupportedByCapabilities({
            capabilities,
            requirements: eventDefinition.requirements,
          }),
        )
        .map((eventDefinition) => ({
          eventType: eventDefinition.eventType,
          displayName: eventDefinition.displayName,
          webhookSourceId: source.id,
          webhookSourceName: source.displayName,
          integrationConnectionId: connection.id,
          integrationConnectionName: connection.displayName,
          integrationTargetKey: connection.targetKey,
          integrationName: metadata.displayName,
          ...(metadata.logoKey === undefined ? {} : { logoKey: metadata.logoKey }),
          ...(eventDefinition.category === undefined ? {} : { category: eventDefinition.category }),
        }));
    });
  });

  return {
    sandboxProfileId: profile.id,
    sandboxProfileName: profile.displayName,
    sandboxProfileVersion: activeVersion,
    events: events.sort((left, right) => {
      const connectionComparison = left.integrationConnectionName.localeCompare(
        right.integrationConnectionName,
      );
      if (connectionComparison !== 0) {
        return connectionComparison;
      }

      const categoryComparison = (left.category ?? "").localeCompare(right.category ?? "");
      if (categoryComparison !== 0) {
        return categoryComparison;
      }

      return left.displayName.localeCompare(right.displayName);
    }),
  };
}

async function getMcpTriggerConfiguration(context: MistleMcpServerContext, triggerId: string) {
  const trigger = await context.db.query.triggers.findFirst({
    columns: {
      kind: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.id, triggerId),
        eq(table.organizationId, context.organizationActor.organizationId),
      ),
  });

  if (trigger === undefined) {
    throw new NotFoundError("NOT_FOUND", "Trigger was not found.");
  }

  if (trigger.kind === TriggerKinds.WEBHOOK) {
    const aggregate = await loadWebhookTriggerAggregateOrThrow(
      { db: context.db },
      {
        organizationId: context.organizationActor.organizationId,
        triggerId,
      },
    );
    return toMcpWebhookTriggerConfiguration(aggregate);
  }

  const aggregate = await loadScheduleTriggerAggregateOrThrow(
    { db: context.db },
    {
      organizationId: context.organizationActor.organizationId,
      triggerId,
    },
  );
  return toMcpScheduleTriggerConfiguration(aggregate);
}

function toMcpWebhookTriggerConfiguration(aggregate: TriggerWebhookAggregate) {
  return {
    id: aggregate.id,
    kind: TriggerKinds.WEBHOOK,
    name: aggregate.name,
    enabled: aggregate.enabled,
    integrationWebhookSourceId: aggregate.integrationWebhookSourceId,
    eventConditions: aggregate.eventConditions,
    inputTemplate: aggregate.inputTemplate,
    instructions: aggregate.instructions,
    conversationKeyTemplate: aggregate.conversationKeyTemplate,
    idempotencyKeyTemplate: aggregate.idempotencyKeyTemplate,
    target: {
      sandboxProfileId: aggregate.target.sandboxProfileId,
      sandboxProfileVersion: aggregate.target.sandboxProfileVersion,
      primaryRepositoryId: aggregate.target.primaryRepositoryId,
    },
    createdAt: aggregate.createdAt,
    updatedAt: aggregate.updatedAt,
  };
}

function toMcpScheduleTriggerConfiguration(aggregate: TriggerScheduleAggregate) {
  return {
    id: aggregate.id,
    kind: TriggerKinds.SCHEDULE,
    name: aggregate.name,
    enabled: aggregate.enabled,
    schedule: {
      kind: aggregate.schedule.kind,
      name: aggregate.schedule.name,
      cronExpression: aggregate.schedule.cronExpression,
      timezone: aggregate.schedule.timezone,
      enabled: aggregate.schedule.enabled,
      nextScheduledAt: normalizeTimestamp(aggregate.schedule.nextScheduledAt),
      lastScheduledAt: normalizeTimestamp(aggregate.schedule.lastScheduledAt),
      startAt: normalizeTimestamp(aggregate.schedule.startAt),
    },
    inputTemplate: aggregate.inputTemplate,
    conversationKeyTemplate: aggregate.conversationKeyTemplate,
    idempotencyKeyTemplate: aggregate.idempotencyKeyTemplate,
    target: {
      sandboxProfileId: aggregate.target.sandboxProfileId,
      sandboxProfileVersion: aggregate.target.sandboxProfileVersion,
      primaryRepositoryId: aggregate.target.primaryRepositoryId,
    },
    createdAt: aggregate.createdAt,
    updatedAt: aggregate.updatedAt,
  };
}

function normalizeTimestamp(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid persisted schedule timestamp '${value}'.`);
  }

  return timestamp.toISOString();
}

function assertHasTriggerUpdateField(input: McpUpdateTriggerInput): void {
  const hasScheduleField =
    input.kind === TriggerKinds.SCHEDULE &&
    input.schedule !== undefined &&
    hasScheduleUpdateField(input.schedule);
  const hasTargetField =
    input.target !== undefined &&
    (input.target.sandboxProfileId !== undefined ||
      input.target.sandboxProfileVersion !== undefined ||
      input.target.primaryRepositoryId !== undefined);

  if (
    input.name !== undefined ||
    input.enabled !== undefined ||
    (input.kind === TriggerKinds.WEBHOOK && input.integrationWebhookSourceId !== undefined) ||
    (input.kind === TriggerKinds.WEBHOOK && input.eventConditions !== undefined) ||
    hasScheduleField ||
    input.inputTemplate !== undefined ||
    (input.kind === TriggerKinds.WEBHOOK && input.instructions !== undefined) ||
    input.conversationKeyTemplate !== undefined ||
    input.idempotencyKeyTemplate !== undefined ||
    hasTargetField
  ) {
    return;
  }

  throw new BadRequestError(
    "INVALID_TRIGGER_UPDATE",
    "update_trigger requires at least one field to update.",
  );
}

function hasScheduleUpdateField(
  schedule: NonNullable<Extract<McpUpdateTriggerInput, { kind: "schedule" }>["schedule"]>,
): boolean {
  if (schedule.name !== undefined) {
    return true;
  }

  if (schedule.kind === "recurring") {
    return schedule.cronExpression !== undefined || schedule.timezone !== undefined;
  }

  return schedule.startAt !== undefined;
}
