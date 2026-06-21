import {
  IntegrationConnectionMethodIds,
  IntegrationFormConnectionMethodCreateBehaviors,
  IntegrationKinds,
  IntegrationMcpTransports,
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
              kind: "secret-field",
              field: "webhookSecret",
            },
          ],
        },
        providerConfigurationSetup: {
          title: "Set up Whapi",
          description:
            "Create or update a Whapi channel webhook with the Mistle webhook URL, then save the API token and webhook secret.",
          webhookCallback: {
            title: "Webhook callback",
            description: "Copy this URL into the webhook URL field in Whapi channel settings.",
            label: "Webhook URL",
            errorTitle: "Could not load webhook URL",
            missingTitle: "Webhook URL is not available yet",
            missingMessage:
              "Whapi setup requires a webhook URL, but this connection does not have one yet.",
          },
          instructions: {
            title: "Whapi setup",
            items: [
              "Open the Whapi channel settings for the WhatsApp channel.",
              "Paste the Mistle webhook URL into the webhook URL field.",
              "Configure a custom callback header named x-whapi-webhook-secret with the Mistle webhook secret. If Whapi Cloud does not show custom callback headers in the channel settings UI, use the Whapi Update channel settings API to set webhooks[].headers.",
              "Enable the webhook events this connection should receive, then save the API token and Mistle webhook secret.",
            ],
          },
          fields: {
            title: "Whapi credentials",
            description:
              "Save the API token for managed egress and the Mistle-generated webhook secret configured as the Whapi custom callback header.",
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
              {
                name: "webhookSecret",
                label: "Mistle webhook secret",
                description:
                  "Copy this value into Whapi as the x-whapi-webhook-secret custom callback header. Configure it through the Whapi Update channel settings API if the Cloud UI does not show custom callback headers.",
                generation: {
                  kind: "random-token",
                },
                inputType: "text",
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
          name: "apiToken",
          label: "API token",
          description: "Whapi API token used through managed egress.",
          placeholder: "Enter API token",
          inputType: "password",
          secretType: WhapiCredentialSecretTypes.API_TOKEN,
          slotKey: WhapiCredentialSlotKeys.API_TOKEN,
        },
        {
          name: "webhookSecret",
          label: "Webhook secret",
          description:
            "Secret value to configure as Whapi custom callback header x-whapi-webhook-secret.",
          placeholder: "Enter webhook secret",
          inputType: "password",
          secretType: WhapiCredentialSecretTypes.WEBHOOK_SECRET,
          slotKey: WhapiCredentialSlotKeys.WEBHOOK_SECRET,
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
