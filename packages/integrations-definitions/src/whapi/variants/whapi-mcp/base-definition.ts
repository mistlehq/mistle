import {
  IntegrationConnectionMethodIds,
  IntegrationFormConnectionMethodCreateBehaviors,
  IntegrationKinds,
  IntegrationMcpTransports,
  ProviderConfigurationSetupCompletedConfigKey,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type WhapiConnectionConfig,
  WhapiConnectionConfigSchema,
  WhapiCredentialSecretTypes,
  WhapiCredentialSlotKeys,
  WhapiFamilyId,
  WhapiMcpVariantId,
} from "./auth.js";
import { WhapiConnectionConfigForm, resolveWhapiBindingConfigForm } from "./binding-config-form.js";
import { WhapiBindingConfigSchema } from "./binding-config-schema.js";
import { compileWhapiBinding, WhapiMcpWrapperPath } from "./compile-binding.js";
import { WhapiSupportedWebhookEvents } from "./supported-webhook-events.js";
import { WhapiTargetConfigSchema } from "./target-config-schema.js";
import { WhapiTargetSecretSchema } from "./target-secret-schema.js";
import { WhapiToolIds } from "./tool-ids.js";

export type WhapiMcpBaseIntegrationDefinition = IntegrationDefinition<
  typeof WhapiTargetConfigSchema,
  typeof WhapiTargetSecretSchema,
  typeof WhapiBindingConfigSchema,
  WhapiConnectionConfig
>;

export const WhapiMcpBaseDefinition: WhapiMcpBaseIntegrationDefinition = {
  familyId: WhapiFamilyId,
  variantId: WhapiMcpVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Whapi",
  description: "Enable Whapi MCP access and webhook triggers for WhatsApp channels.",
  logoKey: "whapi",
  targetConfigSchema: WhapiTargetConfigSchema,
  targetSecretSchema: WhapiTargetSecretSchema,
  bindingConfigSchema: WhapiBindingConfigSchema,
  bindingConfigForm: resolveWhapiBindingConfigForm,
  supportedWebhookEvents: WhapiSupportedWebhookEvents,
  webhookTriggerCapabilitiesRefreshUi: {
    actionLabel: "Sync webhook events",
    pendingLabel: "Syncing...",
  },
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API token",
      kind: "form",
      createBehavior: IntegrationFormConnectionMethodCreateBehaviors.DRAFT_THEN_SETUP,
      setupFlow: {
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "apiToken",
            },
            {
              kind: "config-field",
              field: ProviderConfigurationSetupCompletedConfigKey,
            },
          ],
        },
        providerConfigurationSetup: {
          title: "Set up Whapi",
          description:
            "Save the API token so Mistle can configure this channel's webhook with the displayed callback URL.",
          webhookCallback: {
            title: "Webhook callback",
            description: "Mistle registers this callback URL in Whapi channel settings.",
            label: "Webhook URL",
            errorTitle: "Could not load webhook URL",
            missingTitle: "Webhook URL is not available yet",
            missingMessage:
              "Whapi setup requires a webhook URL, but this connection does not have one yet.",
          },
          instructions: {
            title: "Whapi setup",
            items: [
              "Enter the Whapi API token for the WhatsApp channel.",
              "Save setup so Mistle can register the webhook URL and supported events in Whapi.",
            ],
          },
          fields: {
            title: "Whapi credentials",
            description: "Save the API token for managed egress and webhook configuration.",
            saveLabel: "Save Whapi setup",
            saveErrorMessage: "Could not save Whapi setup.",
            configFields: [],
            secretFields: [
              {
                name: "apiToken",
                label: "API token",
                placeholder: "Enter API token",
                description: "Whapi API token used through managed egress.",
                inputType: "password",
                required: true,
                secretLabel: "API token",
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
          name: "apiToken",
          label: "API token",
          description: "Whapi API token used through managed egress.",
          placeholder: "Enter API token",
          inputType: "password",
          secretType: WhapiCredentialSecretTypes.API_TOKEN,
          slotKey: WhapiCredentialSlotKeys.API_TOKEN,
        },
      ],
      configSchema: WhapiConnectionConfigSchema,
      configForm: WhapiConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(WhapiToolIds.WHAPI_MCP)
      ? [
          {
            serverId: WhapiToolIds.WHAPI_MCP,
            serverName: "whapi",
            transport: IntegrationMcpTransports.STDIO,
            command: WhapiMcpWrapperPath,
            description: "Whapi MCP tools backed by the Whapi connection.",
          },
        ]
      : [],
  compileBinding: compileWhapiBinding,
};
