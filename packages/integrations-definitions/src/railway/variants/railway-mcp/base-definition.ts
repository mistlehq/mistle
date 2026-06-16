import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  RailwayFamilyId,
  type RailwayConnectionConfig,
  RailwayConnectionConfigSchema,
  RailwayMcpUrl,
  RailwayMcpVariantId,
} from "./auth.js";
import { resolveRailwayBindingConfigForm } from "./binding-config-form.js";
import { RailwayBindingConfigSchema } from "./binding-config-schema.js";
import { compileRailwayBinding } from "./compile-binding.js";
import { RailwayTargetConfigSchema } from "./target-config-schema.js";
import { RailwayTargetSecretSchema } from "./target-secret-schema.js";
import { RailwayToolIds } from "./tool-ids.js";

export type RailwayMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof RailwayTargetConfigSchema,
  typeof RailwayTargetSecretSchema,
  typeof RailwayBindingConfigSchema,
  RailwayConnectionConfig
>;

export const RailwayMcpBaseDefinition: RailwayMcpBaseIntegrationDefinition = {
  familyId: RailwayFamilyId,
  variantId: RailwayMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Railway",
  description: "Enable Railway hosted MCP access for projects, services, deployments, and logs.",
  logoKey: "railway",
  targetConfigSchema: RailwayTargetConfigSchema,
  targetSecretSchema: RailwayTargetSecretSchema,
  bindingConfigSchema: RailwayBindingConfigSchema,
  bindingConfigForm: resolveRailwayBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Railway OAuth",
      kind: "redirect",
      configSchema: RailwayConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect Railway",
          helperText: "Authorize Railway hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(RailwayToolIds.RAILWAY_MCP)
      ? [
          {
            serverId: RailwayToolIds.RAILWAY_MCP,
            serverName: "railway",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: RailwayMcpUrl,
            description: "Railway MCP",
          },
        ]
      : [],
  compileBinding: compileRailwayBinding,
};
