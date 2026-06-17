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
import { updateTriggerSchedule } from "../../trigger-schedules/services/update-trigger-schedule.js";
import { createTriggerWebhook } from "../../trigger-webhooks/services/create-trigger-webhook.js";
import { updateTriggerWebhook } from "../../trigger-webhooks/services/update-trigger-webhook.js";
import {
  getTrigger,
  listTriggers,
  ListTriggersQuerySchema,
} from "../../triggers/services/trigger-summaries.js";
import type { MistleMcpServerContext } from "../server.js";
import {
  mcpCreateScheduledTriggerInputSchema,
  mcpCreateWebhookTriggerInputSchema,
  mcpListTriggerWebhookEventsInputSchema,
  mcpListTriggersInputSchema,
  mcpRenameTriggerInputSchema,
  mcpSetTriggerEnabledInputSchema,
  mcpSetTriggerScheduleInputSchema,
  mcpSetTriggerWebhookEventsInputSchema,
  mcpTriggerIdParamsSchema,
  mcpUpdateTriggerUserMessageInputSchema,
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
        "Get one Mistle trigger by ID, including whether it is webhook-based or schedule-based, the target sandbox profile, enabled state, and the user message sent to the agent when it runs.",
      inputSchema: mcpTriggerIdParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get a trigger",
      },
    },
    async ({ triggerId }) => {
      requireMcpTriggerReadPermission(context);

      const trigger = await getTrigger(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          triggerId,
        },
      );

      return structuredResult(trigger);
    },
  );

  server.registerTool(
    "create_scheduled_trigger",
    {
      title: "Create scheduled trigger",
      description:
        "Create a recurring schedule-based Mistle trigger that automatically starts sandbox sessions for a sandbox profile. Provide a cron expression, timezone, target sandbox profile, and user message for the agent to receive each time the trigger runs.",
      inputSchema: mcpCreateScheduledTriggerInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Create scheduled trigger",
      },
    },
    async ({
      conversationKeyTemplate,
      cronExpression,
      enabled,
      idempotencyKeyTemplate,
      name,
      target,
      timezone,
      userMessage,
    }) => {
      requireMcpToolPermission(context.organizationActor, OrganizationPermissions.TRIGGER_CREATE);

      const created = await createTriggerSchedule(
        {
          db: context.db,
          openWorkflow: context.openWorkflow,
        },
        {
          organizationId: context.organizationActor.organizationId,
          name,
          ...(enabled === undefined ? {} : { enabled }),
          schedule: {
            kind: "recurring",
            cronExpression,
            timezone,
          },
          inputTemplate: userMessage,
          ...(conversationKeyTemplate === undefined ? {} : { conversationKeyTemplate }),
          ...(idempotencyKeyTemplate === undefined ? {} : { idempotencyKeyTemplate }),
          target,
          now: context.clock.nowDate(),
        },
      );

      return structuredResult(
        await getTrigger(
          {
            db: context.db,
          },
          {
            organizationId: context.organizationActor.organizationId,
            triggerId: created.id,
          },
        ),
      );
    },
  );

  server.registerTool(
    "create_webhook_trigger",
    {
      title: "Create webhook trigger",
      description:
        "Create a webhook-based Mistle trigger that automatically starts sandbox sessions for a sandbox profile when selected webhook events arrive. Use list_trigger_webhook_events first to discover valid eventTypes for the target sandbox profile and integration webhook source.",
      inputSchema: mcpCreateWebhookTriggerInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Create webhook trigger",
      },
    },
    async ({
      conversationKeyTemplate,
      enabled,
      eventTypes,
      idempotencyKeyTemplate,
      instructions,
      integrationWebhookSourceId,
      name,
      target,
      userMessage,
    }) => {
      requireMcpTriggerCreatePermission(context);

      const created = await createTriggerWebhook(
        {
          db: context.db,
          integrationRegistry: context.integrationRegistry,
        },
        {
          organizationId: context.organizationActor.organizationId,
          name,
          ...(enabled === undefined ? {} : { enabled }),
          integrationWebhookSourceId,
          eventTypes,
          inputTemplate: userMessage,
          ...(instructions === undefined ? {} : { instructions }),
          conversationKeyTemplate,
          ...(idempotencyKeyTemplate === undefined ? {} : { idempotencyKeyTemplate }),
          target,
        },
      );

      return structuredResult(
        await getTrigger(
          {
            db: context.db,
          },
          {
            organizationId: context.organizationActor.organizationId,
            triggerId: created.id,
          },
        ),
      );
    },
  );

  server.registerTool(
    "set_trigger_schedule",
    {
      title: "Set trigger schedule",
      description:
        "Replace the cron expression and timezone for a recurring scheduled Mistle trigger. Use this only for schedule-based triggers that run repeatedly; it recalculates the next scheduled run time from the current server time.",
      inputSchema: mcpSetTriggerScheduleInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Set trigger schedule",
      },
    },
    async ({ cronExpression, timezone, triggerId }) => {
      requireMcpToolPermission(context.organizationActor, OrganizationPermissions.TRIGGER_UPDATE);
      const trigger = await getTrigger(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          triggerId,
        },
      );

      if (trigger.kind !== TriggerKinds.SCHEDULE) {
        throw new BadRequestError(
          "INVALID_TRIGGER_KIND",
          "set_trigger_schedule can only update schedule-based triggers.",
        );
      }

      await updateTriggerSchedule(
        {
          db: context.db,
          openWorkflow: context.openWorkflow,
        },
        {
          organizationId: context.organizationActor.organizationId,
          triggerId,
          now: context.clock.nowDate(),
          schedule: {
            kind: "recurring",
            cronExpression,
            timezone,
          },
        },
      );

      return structuredResult(
        await getTrigger(
          {
            db: context.db,
          },
          {
            organizationId: context.organizationActor.organizationId,
            triggerId,
          },
        ),
      );
    },
  );

  server.registerTool(
    "set_trigger_webhook_events",
    {
      title: "Set trigger webhook events",
      description:
        "Replace the selected event types for an existing webhook-based Mistle trigger using its current webhook source. Use list_trigger_webhook_events first to discover valid event types for the trigger's sandbox profile. This clears existing webhook payload filters because event-scoped filters may no longer match the new event set.",
      inputSchema: mcpSetTriggerWebhookEventsInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Set trigger webhook events",
      },
    },
    async ({ eventTypes, triggerId }) => {
      requireMcpTriggerUpdatePermission(context);
      const trigger = await getTrigger(
        {
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          triggerId,
        },
      );

      if (trigger.kind !== TriggerKinds.WEBHOOK) {
        throw new BadRequestError(
          "INVALID_TRIGGER_KIND",
          "set_trigger_webhook_events can only update webhook-based triggers.",
        );
      }

      await updateTriggerWebhook(
        {
          db: context.db,
          integrationRegistry: context.integrationRegistry,
        },
        {
          organizationId: context.organizationActor.organizationId,
          triggerId,
          eventTypes,
          payloadFilter: null,
        },
      );

      return structuredResult(
        await getTrigger(
          {
            db: context.db,
          },
          {
            organizationId: context.organizationActor.organizationId,
            triggerId,
          },
        ),
      );
    },
  );

  server.registerTool(
    "set_trigger_enabled",
    {
      title: "Set trigger enabled",
      description:
        "Enable or disable a Mistle trigger. Enabled triggers can automatically start sandbox sessions when their webhook event or schedule occurs; disabled triggers remain configured but do not run.",
      inputSchema: mcpSetTriggerEnabledInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Set trigger enabled",
      },
    },
    async ({ enabled, triggerId }) => {
      requireMcpTriggerUpdatePermission(context);

      return structuredResult(
        await updateTriggerByKind(context, {
          triggerId,
          enabled,
        }),
      );
    },
  );

  server.registerTool(
    "rename_trigger",
    {
      title: "Rename trigger",
      description:
        "Rename a Mistle trigger. Use this to change the human-readable label without changing when it runs or which sandbox profile it targets.",
      inputSchema: mcpRenameTriggerInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Rename trigger",
      },
    },
    async ({ name, triggerId }) => {
      requireMcpTriggerUpdatePermission(context);

      return structuredResult(
        await updateTriggerByKind(context, {
          triggerId,
          name,
        }),
      );
    },
  );

  server.registerTool(
    "update_trigger_user_message",
    {
      title: "Update trigger user message",
      description:
        "Update the user message template sent to the agent each time a trigger starts a sandbox session. Use this to change the task or instructions the agent receives when the trigger fires.",
      inputSchema: mcpUpdateTriggerUserMessageInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Update trigger user message",
      },
    },
    async ({ triggerId, userMessage }) => {
      requireMcpTriggerUpdatePermission(context);

      return structuredResult(
        await updateTriggerByKind(context, {
          triggerId,
          inputTemplate: userMessage,
        }),
      );
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

async function updateTriggerByKind(
  context: MistleMcpServerContext,
  input: {
    triggerId: string;
    name?: string;
    enabled?: boolean;
    inputTemplate?: string;
  },
) {
  const trigger = await getTrigger(
    {
      db: context.db,
    },
    {
      organizationId: context.organizationActor.organizationId,
      triggerId: input.triggerId,
    },
  );

  if (trigger.kind === TriggerKinds.WEBHOOK) {
    await updateTriggerWebhook(
      {
        db: context.db,
        integrationRegistry: context.integrationRegistry,
      },
      {
        organizationId: context.organizationActor.organizationId,
        triggerId: input.triggerId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.inputTemplate === undefined ? {} : { inputTemplate: input.inputTemplate }),
      },
    );
  } else {
    await updateTriggerSchedule(
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
        ...(input.inputTemplate === undefined ? {} : { inputTemplate: input.inputTemplate }),
      },
    );
  }

  return getTrigger(
    {
      db: context.db,
    },
    {
      organizationId: context.organizationActor.organizationId,
      triggerId: input.triggerId,
    },
  );
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
