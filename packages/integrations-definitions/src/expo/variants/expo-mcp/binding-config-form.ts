import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { resolveRemoteMcpServerSelectionForm } from "../../../shared/remote-mcp-server-catalog/index.js";
import { ExpoMcpServerCatalog, ExpoMcpServerIds } from "./mcp-catalog.js";

type ExpoBindingFormContext = IntegrationFormContext;

export function resolveExpoBindingConfigForm(
  _input: ExpoBindingFormContext,
): ResolvedIntegrationForm {
  return resolveRemoteMcpServerSelectionForm({
    catalog: ExpoMcpServerCatalog,
    fieldName: "mcpServers",
    title: "Remote MCP servers",
    defaultSelectedIds: [ExpoMcpServerIds.EXPO],
  });
}
