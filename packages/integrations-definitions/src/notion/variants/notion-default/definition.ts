import {
  IntegrationConnectionMethodIds,
  IntegrationConnectionMethodKinds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { type NotionConnectionConfig, NotionConnectionConfigSchema } from "./auth.js";
import { NotionBindingConfigSchema } from "./binding-config-schema.js";
import { compileNotionBinding } from "./compile-binding.js";
import { NotionConnectionConfigForm } from "./connection-config-form.js";
import { NotionOAuth2Capability } from "./oauth2.js";
import { NotionTargetConfigSchema } from "./target-config-schema.js";
import { NotionTargetSecretSchema } from "./target-secret-schema.js";

type NotionIntegrationDefinition = IntegrationDefinition<
  typeof NotionTargetConfigSchema,
  typeof NotionTargetSecretSchema,
  typeof NotionBindingConfigSchema,
  NotionConnectionConfig
>;

export const NotionDefinition: NotionIntegrationDefinition = {
  familyId: "notion",
  variantId: "notion-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Notion",
  description: "Expose a bearer-capable Notion MCP server to sandbox agents through Mistle egress.",
  logoKey: "notion",
  targetConfigSchema: NotionTargetConfigSchema,
  targetSecretSchema: NotionTargetSecretSchema,
  bindingConfigSchema: NotionBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2,
      label: "OAuth2",
      kind: IntegrationConnectionMethodKinds.OAUTH2,
      configSchema: NotionConnectionConfigSchema,
      configForm: NotionConnectionConfigForm,
    },
  ],
  oauth2: NotionOAuth2Capability,
  mcp: (input) => ({
    serverId: "notion-default",
    serverName: "notion",
    transport: IntegrationMcpTransports.STREAMABLE_HTTP,
    url: input.target.config.mcpBaseUrl,
    description: "Notion MCP",
  }),
  compileBinding: compileNotionBinding,
};
