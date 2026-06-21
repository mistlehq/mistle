import {
  IntegrationConnectionMethodIds,
  IntegrationFormConnectionMethodCreateBehaviors,
  IntegrationKinds,
  IntegrationMcpTransports,
  ProviderConfigurationSetupCompletedConfigKey,
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
      createBehavior: IntegrationFormConnectionMethodCreateBehaviors.DRAFT_THEN_SETUP,
      setupFlow: {
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "personalAccessToken",
            },
            {
              kind: "secret-field",
              field: "webhookSecret",
            },
            {
              kind: "config-field",
              field: ProviderConfigurationSetupCompletedConfigKey,
            },
          ],
        },
        providerConfigurationSetup: {
          title: "Set up WasenderAPI",
          description:
            "Create or update a WasenderAPI WhatsApp session with the Mistle webhook URL, then save the account Personal Access Token and session webhook secret.",
          webhookCallback: {
            title: "Webhook callback",
            description: "Copy this URL into the Webhook URL field in WasenderAPI.",
            label: "Webhook URL",
            errorTitle: "Could not load webhook URL",
            missingTitle: "Webhook URL is not available yet",
            missingMessage:
              "WasenderAPI setup requires a webhook URL, but this connection does not have one yet.",
          },
          instructions: {
            title: "WasenderAPI setup",
            items: [
              "Create or edit a WhatsApp session in WasenderAPI.",
              "Paste the Mistle webhook URL into the session Webhook URL field.",
              "Enable webhook notifications for messages.received and messages.upsert.",
              "Copy the account Personal Access Token from WasenderAPI Settings and the session webhook secret back into Mistle.",
            ],
          },
          fields: {
            title: "WasenderAPI credentials",
            description:
              "Save the account Personal Access Token for MCP access and the webhook secret after configuring the session webhook.",
            saveLabel: "Save WasenderAPI setup",
            saveErrorMessage: "Could not save WasenderAPI setup.",
            configFields: [],
            secretFields: [
              {
                name: "personalAccessToken",
                label: "Personal access token",
                placeholder: "Enter personal access token",
                description:
                  "Use the account-level Personal Access Token from WasenderAPI Settings. Do not use the session API Access Token from API Credentials.",
                inputType: "password",
                required: true,
                secretLabel: "personal access token",
              },
              {
                name: "webhookSecret",
                label: "Webhook secret",
                placeholder: "Enter webhook secret",
                description: "Webhook secret generated for the WasenderAPI session.",
                inputType: "password",
                required: true,
                secretLabel: "webhook secret",
              },
            ],
          },
        },
        routeSegment: "provider-configuration",
        setupPane: {
          kind: "provider-configuration",
        },
      },
      secretFields: [
        {
          name: "personalAccessToken",
          label: "Personal access token",
          placeholder: "Enter personal access token",
          description:
            "Use the account-level Personal Access Token from WasenderAPI Settings. Do not use the session API Access Token from API Credentials.",
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
