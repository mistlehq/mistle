import { TriggerKinds } from "@mistle/db/control-plane";
import { ForbiddenError } from "@mistle/http/errors.js";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import {
  hasTriggerReadPermission,
  hasTriggerUpdatePermission,
} from "../../auth/services/organization-policy.js";
import { updateTriggerSchedule } from "../../trigger-schedules/services/update-trigger-schedule.js";
import { updateTriggerWebhook } from "../../trigger-webhooks/services/update-trigger-webhook.js";
import {
  getTrigger,
  listTriggers,
  ListTriggersQuerySchema,
} from "../../triggers/services/trigger-summaries.js";
import type { MistleMcpServerContext } from "../server.js";
import {
  mcpListTriggersInputSchema,
  mcpRenameTriggerInputSchema,
  mcpSetTriggerEnabledInputSchema,
  mcpTriggerIdParamsSchema,
  mcpUpdateTriggerUserMessageInputSchema,
} from "../tool-schemas.js";
import { structuredResult } from "./shared.js";

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
