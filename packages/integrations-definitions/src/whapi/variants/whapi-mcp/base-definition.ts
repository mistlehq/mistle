import {
  IntegrationConnectionMethodIds,
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
