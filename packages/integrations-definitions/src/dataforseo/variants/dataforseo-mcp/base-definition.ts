import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  DataForSeoFamilyId,
  type DataForSeoConnectionConfig,
  DataForSeoConnectionConfigSchema,
  DataForSeoMcpUrl,
  DataForSeoMcpVariantId,
} from "./auth.js";
import { resolveDataForSeoBindingConfigForm } from "./binding-config-form.js";
import { DataForSeoBindingConfigSchema } from "./binding-config-schema.js";
import { compileDataForSeoBinding } from "./compile-binding.js";
import { DataForSeoTargetConfigSchema } from "./target-config-schema.js";
import { DataForSeoTargetSecretSchema } from "./target-secret-schema.js";
import { DataForSeoToolIds } from "./tool-ids.js";

export type DataForSeoMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof DataForSeoTargetConfigSchema,
  typeof DataForSeoTargetSecretSchema,
  typeof DataForSeoBindingConfigSchema,
  DataForSeoConnectionConfig
>;

export const DataForSeoMcpBaseDefinition: DataForSeoMcpBaseIntegrationDefinition = {
  familyId: DataForSeoFamilyId,
  variantId: DataForSeoMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "DataForSEO",
  description: "Enable DataForSEO hosted MCP access for SEO and marketing data APIs.",
  logoKey: "dataforseo",
  targetConfigSchema: DataForSeoTargetConfigSchema,
  targetSecretSchema: DataForSeoTargetSecretSchema,
  bindingConfigSchema: DataForSeoBindingConfigSchema,
  bindingConfigForm: resolveDataForSeoBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "DataForSEO OAuth",
      kind: "redirect",
      configSchema: DataForSeoConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect DataForSEO",
          helperText: "Authorize DataForSEO hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(DataForSeoToolIds.DATAFORSEO_MCP)
      ? [
          {
            serverId: DataForSeoToolIds.DATAFORSEO_MCP,
            serverName: "dataforseo",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: DataForSeoMcpUrl,
            description: "DataForSEO MCP",
          },
        ]
      : [],
  compileBinding: compileDataForSeoBinding,
};
