import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { resolveRemoteMcpServerSelectionForm } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GoogleWorkspaceMcpServerCatalog } from "./mcp-catalog.js";

type GoogleWorkspaceBindingFormContext = IntegrationFormContext;

export function resolveGoogleWorkspaceBindingConfigForm(
  _input: GoogleWorkspaceBindingFormContext,
): ResolvedIntegrationForm {
  return resolveRemoteMcpServerSelectionForm({
    catalog: GoogleWorkspaceMcpServerCatalog,
    fieldName: "mcpServers",
    title: "Google Workspace MCP servers",
  });
}
