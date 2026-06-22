import { listSupportedCapabilities } from "@mistle/integrations-definitions/server";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import type { MistleMcpServerContext } from "../server.js";
import { mcpListSupportedCapabilitiesInputSchema } from "../tool-schemas.js";
import { requireMcpToolPermission, structuredResult } from "./shared.js";

const ReadOnlyToolAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function registerCapabilityTools(server: McpServer, context: MistleMcpServerContext): void {
  server.registerTool(
    "list_supported_capabilities",
    {
      title: "List supported capabilities",
      description:
        "List Mistle-supported integration, runtime tool, trigger event, provider resource, and setup capabilities. This reports what Mistle can support in principle, not what is currently connected or available in the organization.",
      inputSchema: mcpListSupportedCapabilitiesInputSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List supported capabilities",
      },
    },
    async (input) => {
      requireCapabilityCatalogReadPermission(context);

      return structuredResult(listSupportedCapabilities(context.integrationRegistry, input));
    },
  );
}

function requireCapabilityCatalogReadPermission(context: MistleMcpServerContext): void {
  if (context.organizationActor.kind === "mcp_capability") {
    return;
  }

  requireMcpToolPermission(
    context.organizationActor,
    OrganizationPermissions.INTEGRATION_CONNECTION_READ,
  );
}
