import {
  IntegrationConnectionMethodIds,
  type IntegrationFormContext,
  type ResolvedIntegrationForm,
} from "@mistle/integrations-core";

import { resolveRemoteMcpServerSelectionForm } from "../../../shared/remote-mcp-server-catalog/index.js";
import { CloudflareMcpServerCatalog, CloudflareMcpServerIds } from "./mcp-catalog.js";

type CloudflareBindingFormContext = IntegrationFormContext;

export function resolveCloudflareBindingConfigForm(
  _input: CloudflareBindingFormContext,
): ResolvedIntegrationForm {
  return resolveRemoteMcpServerSelectionForm({
    catalog: CloudflareMcpServerCatalog,
    fieldName: "mcpServers",
    title: "Cloudflare MCP servers",
    defaultSelectedIds: [CloudflareMcpServerIds.CLOUDFLARE_API],
  });
}

export const CloudflareConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: IntegrationConnectionMethodIds.API_KEY,
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
