import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { resolveRemoteMcpServerSelectionForm } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GcpMcpServerCatalog } from "./mcp-catalog.js";

type GcpBindingFormContext = IntegrationFormContext;

export function resolveGcpBindingConfigForm(
  _input: GcpBindingFormContext,
): ResolvedIntegrationForm {
  return resolveRemoteMcpServerSelectionForm({
    catalog: GcpMcpServerCatalog,
    fieldName: "mcpServers",
    title: "Google Cloud MCP servers",
  });
}
