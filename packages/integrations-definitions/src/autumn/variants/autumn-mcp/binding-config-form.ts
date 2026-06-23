import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { resolveRemoteMcpServerSelectionForm } from "../../../shared/remote-mcp-server-catalog/index.js";
import { AutumnMcpServerCatalog, AutumnMcpServerIds } from "./mcp-catalog.js";

type AutumnBindingFormContext = IntegrationFormContext;

export function resolveAutumnBindingConfigForm(
  _input: AutumnBindingFormContext,
): ResolvedIntegrationForm {
  return resolveRemoteMcpServerSelectionForm({
    catalog: AutumnMcpServerCatalog,
    fieldName: "mcpServers",
    title: "Autumn MCP servers",
    defaultSelectedIds: [AutumnMcpServerIds.AUTUMN],
  });
}
