import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type SentryConnectionConfig,
  SentryConnectionMethodIds,
  SentryCredentialSecretTypes,
  SentryWebhookSigningSecretConnectionConfigSchema,
  SentryWebhookSigningSecretCredentialSlotKeys,
  SentryMcpOAuthConnectionConfigSchema,
  SentryMcpUrl,
} from "./auth.js";
import { resolveSentryBindingConfigForm } from "./binding-config-form.js";
import { SentryBindingConfigSchema } from "./binding-config-schema.js";
import { compileSentryBinding } from "./compile-binding.js";
import { SentrySupportedWebhookEvents } from "./supported-webhook-events.js";
import { SentryTargetConfigSchema } from "./target-config-schema.js";
import { SentryTargetSecretSchema } from "./target-secret-schema.js";
import { SentryToolIds } from "./tool-ids.js";

export type SentryDefaultBaseIntegrationDefinition = IntegrationDefinition<
  typeof SentryTargetConfigSchema,
  typeof SentryTargetSecretSchema,
  typeof SentryBindingConfigSchema,
  SentryConnectionConfig
>;

export const SentryDefaultBaseDefinition: SentryDefaultBaseIntegrationDefinition = {
  familyId: "sentry",
  variantId: "sentry-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Sentry",
  description: "Enable Sentry issue webhooks and hosted MCP access.",
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
      configSchema: SentryMcpOAuthConnectionConfigSchema,
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
    {
      id: SentryConnectionMethodIds.WEBHOOK_SIGNING_SECRET,
      label: "Sentry webhooks",
      kind: "form",
      secretFields: [
        {
          name: "clientSecret",
          label: "Client secret",
          placeholder: "Enter Sentry integration client secret",
          description: "Client secret from the Sentry Internal Integration used to sign webhooks.",
          inputType: "password",
          secretType: SentryCredentialSecretTypes.OAUTH2_CLIENT_SECRET,
          slotKey: SentryWebhookSigningSecretCredentialSlotKeys.CLIENT_SECRET,
        },
      ],
      configSchema: SentryWebhookSigningSecretConnectionConfigSchema,
      connectionDetail: {
        installation: {
          hideWebhookSourceSection: true,
          includeWebhookCallbackUrl: true,
        },
      },
      ui: {
        create: {
          submitLabel: "Save Sentry webhook secret",
          helperText: "Save a Sentry Internal Integration client secret for webhook verification.",
        },
      },
    },
  ],
  supportedWebhookEvents: SentrySupportedWebhookEvents,
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
