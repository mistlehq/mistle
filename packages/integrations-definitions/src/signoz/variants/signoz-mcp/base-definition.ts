import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type SignozConnectionConfig,
  SignozConnectionConfigSchema,
  SignozConnectionStartConfigSchema,
  resolveSignozMcpUrl,
} from "./auth.js";
import { resolveSignozBindingConfigForm } from "./binding-config-form.js";
import { SignozBindingConfigSchema } from "./binding-config-schema.js";
import { compileSignozBinding } from "./compile-binding.js";
import { SignozTargetConfigSchema } from "./target-config-schema.js";
import { SignozTargetSecretSchema } from "./target-secret-schema.js";
import { SignozToolIds } from "./tool-ids.js";

export type SignozMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof SignozTargetConfigSchema,
  typeof SignozTargetSecretSchema,
  typeof SignozBindingConfigSchema,
  SignozConnectionConfig
>;

export const SignozMcpBaseDefinition: SignozMcpBaseIntegrationDefinition = {
  familyId: "signoz",
  variantId: "signoz-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "SigNoz",
  description: "Enable SigNoz hosted MCP access for observability tools and search.",
  logoKey: "signoz",
  targetConfigSchema: SignozTargetConfigSchema,
  targetSecretSchema: SignozTargetSecretSchema,
  bindingConfigSchema: SignozBindingConfigSchema,
  bindingConfigForm: resolveSignozBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "SigNoz OAuth",
      kind: "redirect",
      configSchema: SignozConnectionConfigSchema,
      startConfigSchema: SignozConnectionStartConfigSchema,
      startConfigForm: () => ({
        schema: {
          type: "object",
          properties: {
            region: {
              type: "string",
              title: "Region",
              description:
                "SigNoz Cloud region shown in Settings > Ingestion. This is used to build the hosted MCP URL.",
            },
          },
          required: ["region"],
        },
        uiSchema: {
          region: {
            "ui:placeholder": "us",
          },
        },
      }),
      ui: {
        create: {
          submitLabel: "Connect SigNoz",
          helperText: "Authorize SigNoz hosted MCP access.",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(SignozToolIds.SIGNOZ_MCP)
      ? [
          {
            serverId: SignozToolIds.SIGNOZ_MCP,
            serverName: "signoz",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: resolveSignozMcpUrl(
              SignozConnectionConfigSchema.parse(input.connection.config).region,
            ),
            description: "SigNoz MCP",
          },
        ]
      : [],
  compileBinding: compileSignozBinding,
};
