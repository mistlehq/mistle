import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { type SentryConnectionConfig, SentryConnectionConfigSchema, SentryMcpUrl } from "./auth.js";
import { resolveSentryBindingConfigForm } from "./binding-config-form.js";
import { SentryBindingConfigSchema } from "./binding-config-schema.js";
import { compileSentryBinding } from "./compile-binding.js";
import { SentryTargetConfigSchema } from "./target-config-schema.js";
import { SentryTargetSecretSchema } from "./target-secret-schema.js";
import { SentryToolIds } from "./tool-ids.js";

export type SentryMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof SentryTargetConfigSchema,
  typeof SentryTargetSecretSchema,
  typeof SentryBindingConfigSchema,
  SentryConnectionConfig
>;

export const SentryMcpBaseDefinition: SentryMcpBaseIntegrationDefinition = {
  familyId: "sentry",
  variantId: "sentry-mcp",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Sentry",
  description: "Enable Sentry hosted MCP access for issues, traces, releases, and projects.",
  logoKey: "sentry",
  targetConfigSchema: SentryTargetConfigSchema,
  targetSecretSchema: SentryTargetSecretSchema,
  bindingConfigSchema: SentryBindingConfigSchema,
  bindingConfigForm: resolveSentryBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Sentry MCP OAuth",
      kind: "redirect",
      configSchema: SentryConnectionConfigSchema,
      ui: {
        create: {
          submitLabel: "Connect Sentry",
          helperText: "Authorize Sentry hosted MCP access.",
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(SentryToolIds.SENTRY_MCP)
      ? [
          {
            serverId: SentryToolIds.SENTRY_MCP,
            serverName: "sentry",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: SentryMcpUrl,
            description: "Sentry MCP",
          },
        ]
      : [],
  compileBinding: compileSentryBinding,
};
