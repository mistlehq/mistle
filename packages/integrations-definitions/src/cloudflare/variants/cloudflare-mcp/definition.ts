import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { resolveRemoteMcpServers } from "../../../shared/remote-mcp-server-catalog/index.js";
import {
  type CloudflareConnectionConfig,
  CloudflareConnectionConfigSchema,
  CloudflareCredentialSecretTypes,
  CloudflareCredentialSlotKeys,
} from "./auth.js";
import { resolveCloudflareBindingConfigForm } from "./binding-config-form.js";
import { CloudflareBindingConfigSchema } from "./binding-config-schema.js";
import { compileCloudflareBinding } from "./compile-binding.js";
import { CloudflareMcpServerCatalog } from "./mcp-catalog.js";
import { CloudflareTargetConfigSchema } from "./target-config-schema.js";
import { CloudflareTargetSecretSchema } from "./target-secret-schema.js";

export type CloudflareMcpIntegrationDefinition = IntegrationDefinition<
  typeof CloudflareTargetConfigSchema,
  typeof CloudflareTargetSecretSchema,
  typeof CloudflareBindingConfigSchema,
  CloudflareConnectionConfig
>;

export const CloudflareDefinition: CloudflareMcpIntegrationDefinition = {
  familyId: "cloudflare",
  variantId: "cloudflare-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Cloudflare",
  description: "Enable Cloudflare API MCP Code Mode access.",
  logoKey: "cloudflare",
  targetConfigSchema: CloudflareTargetConfigSchema,
  targetSecretSchema: CloudflareTargetSecretSchema,
  bindingConfigSchema: CloudflareBindingConfigSchema,
  bindingConfigForm: resolveCloudflareBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API token",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "Cloudflare API token",
          placeholder: "Enter Cloudflare API token",
          description: "Use a Cloudflare API token scoped to the account operations you need.",
          inputType: "password",
          secretType: CloudflareCredentialSecretTypes.API_KEY,
          slotKey: CloudflareCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: CloudflareConnectionConfigSchema,
    },
  ],
  mcp: (input) =>
    resolveRemoteMcpServers({
      catalog: CloudflareMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
    }),
  compileBinding: compileCloudflareBinding,
};
