import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type WasenderApiConnectionConfig,
  WasenderApiConnectionConfigSchema,
  WasenderApiCredentialSecretTypes,
  WasenderApiCredentialSlotKeys,
  WasenderApiFamilyId,
  WasenderApiMcpVariantId,
} from "./auth.js";
import { resolveWasenderApiBindingConfigForm } from "./binding-config-form.js";
import { WasenderApiBindingConfigSchema } from "./binding-config-schema.js";
import { compileWasenderApiBinding } from "./compile-binding.js";
import { WasenderApiConnectionConfigForm } from "./connection-config-form.js";
import { WasenderApiSupportedWebhookEvents } from "./supported-webhook-events.js";
import { resolveWasenderApiMcpUrl, WasenderApiTargetConfigSchema } from "./target-config-schema.js";
import { WasenderApiTargetSecretSchema } from "./target-secret-schema.js";
import { WasenderApiToolIds } from "./tool-ids.js";

export type WasenderApiBaseIntegrationDefinition = IntegrationDefinition<
  typeof WasenderApiTargetConfigSchema,
  typeof WasenderApiTargetSecretSchema,
  typeof WasenderApiBindingConfigSchema,
  WasenderApiConnectionConfig
>;

export const WasenderApiBaseDefinition: WasenderApiBaseIntegrationDefinition = {
  familyId: WasenderApiFamilyId,
  variantId: WasenderApiMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "WasenderAPI",
  description: "Enable WasenderAPI hosted MCP access for WhatsApp sessions.",
  logoKey: "wasenderapi",
  targetConfigSchema: WasenderApiTargetConfigSchema,
  targetSecretSchema: WasenderApiTargetSecretSchema,
  bindingConfigSchema: WasenderApiBindingConfigSchema,
  bindingConfigForm: resolveWasenderApiBindingConfigForm,
  supportedWebhookEvents: WasenderApiSupportedWebhookEvents,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "Personal access token",
      kind: "form",
      secretFields: [
        {
          name: "personalAccessToken",
          label: "Personal access token",
          placeholder: "Enter personal access token",
          inputType: "password",
          secretType: WasenderApiCredentialSecretTypes.PERSONAL_ACCESS_TOKEN,
          slotKey: WasenderApiCredentialSlotKeys.PERSONAL_ACCESS_TOKEN,
        },
        {
          name: "webhookSecret",
          label: "Webhook secret",
          placeholder: "Enter webhook secret",
          description: "WasenderAPI webhook secret configured in the WasenderAPI dashboard.",
          inputType: "password",
          secretType: WasenderApiCredentialSecretTypes.WEBHOOK_SECRET,
          slotKey: WasenderApiCredentialSlotKeys.WEBHOOK_SECRET,
        },
      ],
      configSchema: WasenderApiConnectionConfigSchema,
      configForm: WasenderApiConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(WasenderApiToolIds.WASENDERAPI_MCP)
      ? [
          {
            serverId: WasenderApiToolIds.WASENDERAPI_MCP,
            serverName: "wasenderapi",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: resolveWasenderApiMcpUrl(),
            description: "WasenderAPI MCP",
          },
        ]
      : [],
  compileBinding: compileWasenderApiBinding,
};
