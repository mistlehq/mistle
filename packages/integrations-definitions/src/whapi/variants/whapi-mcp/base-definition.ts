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
          kind: "secret-field",
          field: "apiToken",
        },
        providerConfigurationSetup: {
          title: "Set up Whapi",
          description:
            "Create or update a Whapi channel webhook with the Mistle webhook URL, then save the API token.",
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
              "Enable the webhook events this connection should receive, then save the API token.",
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
