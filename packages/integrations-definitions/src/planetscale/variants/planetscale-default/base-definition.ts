import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { PlanetScaleConnectionConfigSchema, type PlanetScaleConnectionConfig } from "./auth.js";
import { resolvePlanetScaleBindingConfigForm } from "./binding-config-form.js";
import { PlanetScaleBindingConfigSchema } from "./binding-config-schema.js";
import { compilePlanetScaleBinding } from "./compile-binding.js";
import { PlanetScaleTargetConfigSchema } from "./target-config-schema.js";
import { PlanetScaleTargetSecretSchema } from "./target-secret-schema.js";
import { PlanetScaleToolIds } from "./tool-ids.js";

export type PlanetScaleBaseIntegrationDefinition = IntegrationDefinition<
  typeof PlanetScaleTargetConfigSchema,
  typeof PlanetScaleTargetSecretSchema,
  typeof PlanetScaleBindingConfigSchema,
  PlanetScaleConnectionConfig
>;

export const PlanetScaleBaseDefinition: PlanetScaleBaseIntegrationDefinition = {
  familyId: "planetscale",
  variantId: "planetscale-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "PlanetScale",
  description:
    "Enable PlanetScale API access, CLI workflows, and optional hosted MCP servers from agents.",
  logoKey: "planetscale",
  targetConfigSchema: PlanetScaleTargetConfigSchema,
  targetSecretSchema: PlanetScaleTargetSecretSchema,
  bindingConfigSchema: PlanetScaleBindingConfigSchema,
  bindingConfigForm: resolvePlanetScaleBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "OAuth",
      kind: "redirect",
      configSchema: PlanetScaleConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect with PlanetScale",
          helperText: "Authorize this workspace with PlanetScale using OAuth.",
        },
      },
    },
  ],
  mcp: (input) => [
    ...(input.binding.config.tools.includes(PlanetScaleToolIds.PLANETSCALE_MCP)
      ? [
          {
            serverId: "planetscale-default",
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
            serverId: "planetscale-insights-default",
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
