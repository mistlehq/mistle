import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { type NotionConnectionConfig, NotionConnectionConfigSchema, NotionMcpUrl } from "./auth.js";
import { resolveNotionBindingConfigForm } from "./binding-config-form.js";
import { NotionBindingConfigSchema } from "./binding-config-schema.js";
import { compileNotionBinding } from "./compile-binding.js";
import { NotionTargetConfigSchema } from "./target-config-schema.js";
import { NotionTargetSecretSchema } from "./target-secret-schema.js";
import { NotionToolIds } from "./tool-ids.js";

export type NotionMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof NotionTargetConfigSchema,
  typeof NotionTargetSecretSchema,
  typeof NotionBindingConfigSchema,
  NotionConnectionConfig
>;

export const NotionMcpBaseDefinition: NotionMcpBaseIntegrationDefinition = {
  familyId: "notion",
  variantId: "notion-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Notion",
  description:
    "Enable Notion hosted MCP access for workspace search, pages, databases, and comments.",
  logoKey: "notion",
  targetConfigSchema: NotionTargetConfigSchema,
  targetSecretSchema: NotionTargetSecretSchema,
  bindingConfigSchema: NotionBindingConfigSchema,
  bindingConfigForm: resolveNotionBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Notion MCP OAuth",
      kind: "redirect",
      configSchema: NotionConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect Notion",
          helperText: "Authorize Notion hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(NotionToolIds.NOTION_MCP)
      ? [
          {
            serverId: NotionToolIds.NOTION_MCP,
            serverName: "notion",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: NotionMcpUrl,
            description: "Notion MCP",
          },
        ]
      : [],
  compileBinding: compileNotionBinding,
};
