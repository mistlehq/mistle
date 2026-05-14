import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { type PlanetScaleConnectionConfig, PlanetScaleConnectionConfigSchema } from "./auth.js";
import { resolvePlanetScaleBindingConfigForm } from "./binding-config-form.js";
import { PlanetScaleBindingConfigSchema } from "./binding-config-schema.js";
import { compilePlanetScaleBinding } from "./compile-binding.js";
import { PlanetScaleTargetConfigSchema } from "./target-config-schema.js";
import { PlanetScaleTargetSecretSchema } from "./target-secret-schema.js";
import { PlanetScaleToolIds } from "./tool-ids.js";

export type PlanetScaleMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof PlanetScaleTargetConfigSchema,
  typeof PlanetScaleTargetSecretSchema,
  typeof PlanetScaleBindingConfigSchema,
  PlanetScaleConnectionConfig
>;

export const PlanetScaleMcpBaseDefinition: PlanetScaleMcpBaseIntegrationDefinition = {
  familyId: "planetscale",
  variantId: "planetscale-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "PlanetScale",
  description: "Enable PlanetScale hosted MCP access for databases, schema, and insights.",
  logoKey: "planetscale",
  targetConfigSchema: PlanetScaleTargetConfigSchema,
  targetSecretSchema: PlanetScaleTargetSecretSchema,
  bindingConfigSchema: PlanetScaleBindingConfigSchema,
  bindingConfigForm: resolvePlanetScaleBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "PlanetScale OAuth",
      kind: "redirect",
      configSchema: PlanetScaleConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect PlanetScale",
          helperText: "Authorize PlanetScale hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) => [
    ...(input.binding.config.tools.includes(PlanetScaleToolIds.PLANETSCALE_MCP)
      ? [
          {
            serverId: PlanetScaleToolIds.PLANETSCALE_MCP,
            serverName: "planetscale",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: "https://mcp.pscale.dev/mcp/planetscale",
            description: "PlanetScale MCP",
          },
        ]
      : []),
    ...(input.binding.config.tools.includes(PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP)
      ? [
          {
            serverId: PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
            serverName: "planetscale_insights",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: "https://mcp.pscale.dev/mcp/planetscale-insights-only",
            description: "PlanetScale Insights MCP",
          },
        ]
      : []),
  ],
  compileBinding: compilePlanetScaleBinding,
};
