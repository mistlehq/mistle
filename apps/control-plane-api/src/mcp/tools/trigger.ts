import { ForbiddenError } from "@mistle/http/errors.js";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import { hasTriggerReadPermission } from "../../auth/services/organization-policy.js";
import {
  getTrigger,
  listTriggers,
  ListTriggersQuerySchema,
} from "../../triggers/services/trigger-summaries.js";
import type { MistleMcpServerContext } from "../server.js";
import { mcpListTriggersInputSchema, mcpTriggerIdParamsSchema } from "../tool-schemas.js";
import { structuredResult } from "./shared.js";

const ReadOnlyToolAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function registerTriggerTools(server: McpServer, context: MistleMcpServerContext): void {
  server.registerTool(
    "list_triggers",
    {
      title: "List triggers",
      description: "List triggers available to the current Mistle actor",
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
      description: "Get a trigger by id using the current Mistle actor",
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
}

function requireMcpTriggerReadPermission(context: MistleMcpServerContext): void {
  if (hasTriggerReadPermission(context.organizationActor.permissions)) {
    return;
  }

  throw new ForbiddenError("FORBIDDEN", "Missing required MCP permission: trigger:read.");
}
