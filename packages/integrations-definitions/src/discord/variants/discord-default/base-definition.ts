import {
  IntegrationFormConnectionMethodCreateBehaviors,
  IntegrationKinds,
  IntegrationMcpTransports,
  ProviderConfigurationSetupCompletedConfigKey,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type DiscordConnectionConfig,
  DiscordConnectionConfigSchema,
  DiscordConnectionMethodId,
  DiscordCredentialSecretTypes,
  DiscordCredentialSlotKeys,
  DiscordDefaultVariantId,
  DiscordFamilyId,
} from "./auth.js";
import { resolveDiscordBindingConfigForm } from "./binding-config-form.js";
import { DiscordBindingConfigSchema } from "./binding-config-schema.js";
import { compileDiscordBinding, DiscordMcpUrl } from "./compile-binding.js";
import { DiscordConnectionConfigForm } from "./connection-config-form.js";
import { DiscordSupportedWebhookEvents } from "./supported-webhook-events.js";
import { DiscordTargetConfigSchema } from "./target-config-schema.js";
import { DiscordTargetSecretSchema } from "./target-secret-schema.js";
import { DiscordToolIds } from "./tool-ids.js";

export type DiscordBaseIntegrationDefinition = IntegrationDefinition<
  typeof DiscordTargetConfigSchema,
  typeof DiscordTargetSecretSchema,
  typeof DiscordBindingConfigSchema,
  DiscordConnectionConfig
>;

export const DiscordBaseDefinition: DiscordBaseIntegrationDefinition = {
  familyId: DiscordFamilyId,
  variantId: DiscordDefaultVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Discord",
  description:
    "Enable access to Discord REST API operations, local Discord MCP tools, and signed Discord HTTP callbacks.",
  logoKey: "discord",
  targetConfigSchema: DiscordTargetConfigSchema,
  targetSecretSchema: DiscordTargetSecretSchema,
  bindingConfigSchema: DiscordBindingConfigSchema,
  bindingConfigForm: resolveDiscordBindingConfigForm,
  supportedWebhookEvents: DiscordSupportedWebhookEvents,
  connectionMethods: [
    {
      id: DiscordConnectionMethodId,
      label: "Discord bot",
      kind: "form",
      createBehavior: IntegrationFormConnectionMethodCreateBehaviors.DRAFT_THEN_SETUP,
      setupFlow: {
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "botToken",
            },
            {
              kind: "secret-field",
              field: "publicKey",
            },
            {
              kind: "config-field",
              field: ProviderConfigurationSetupCompletedConfigKey,
            },
          ],
        },
        providerConfigurationSetup: {
          title: "Set up Discord",
          description:
            "Create or edit a Discord application, save the bot token and public key in Mistle, then configure the interactions endpoint with the Mistle webhook URL.",
          webhookCallback: {
            title: "Discord callback",
            description:
              "Copy this URL into the Discord application's Interactions Endpoint URL field. Discord Webhook Events can also target this callback when enabled.",
            label: "Callback URL",
            errorTitle: "Could not load callback URL",
            missingTitle: "Callback URL is not available yet",
            missingMessage:
              "Discord setup requires a callback URL, but this connection does not have one yet.",
          },
          instructions: {
            title: "Discord setup",
            items: [
              "Create or open a Discord application in the Discord Developer Portal.",
              "Add a bot to the application and install it into the guilds where Mistle should operate.",
              "Copy the application's public key and save it in Mistle.",
              "Copy the bot token and save it in Mistle.",
              "Paste the Mistle callback URL into the Interactions Endpoint URL field after saving the public key.",
              "Enable the Gateway intents needed for channel-message and reaction triggers, including Message Content when message text filters are required.",
              "Run a Discord Gateway relay that posts signed Gateway dispatch payloads to the Mistle callback URL when using Gateway triggers.",
            ],
          },
          fields: {
            title: "Discord credentials",
            description:
              "Save the Discord bot token for REST/MCP access and the application public key for signed callback verification.",
            saveLabel: "Save Discord setup",
            saveErrorMessage: "Could not save Discord setup.",
            configFields: [
              {
                configKey: "application_id",
                name: "application_id",
                label: "Application ID",
                placeholder: "Discord application ID",
                description: "Optional Discord application ID.",
                inputType: "text",
                required: false,
              },
            ],
            secretFields: [
              {
                name: "botToken",
                label: "Bot token",
                placeholder: "Enter bot token",
                description: "Discord bot token. Do not include the 'Bot ' prefix.",
                inputType: "password",
                required: true,
                secretLabel: "bot token",
              },
              {
                name: "publicKey",
                label: "Public key",
                placeholder: "Discord application public key",
                description:
                  "Hex-encoded Discord application public key used to verify signed callbacks.",
                inputType: "password",
                required: true,
                secretLabel: "public key",
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
          name: "botToken",
          label: "Bot token",
          placeholder: "Enter bot token",
          description: "Discord bot token. Do not include the 'Bot ' prefix.",
          inputType: "password",
          secretType: DiscordCredentialSecretTypes.API_KEY,
          slotKey: DiscordCredentialSlotKeys.BOT_TOKEN,
        },
        {
          name: "publicKey",
          label: "Public key",
          placeholder: "Discord application public key",
          description: "Hex-encoded Discord application public key for callback verification.",
          inputType: "password",
          secretType: DiscordCredentialSecretTypes.API_KEY,
          slotKey: DiscordCredentialSlotKeys.PUBLIC_KEY,
        },
      ],
      configSchema: DiscordConnectionConfigSchema,
      configForm: DiscordConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(DiscordToolIds.DISCORD_MCP)
      ? [
          {
            serverId: DiscordToolIds.DISCORD_MCP,
            serverName: "discord",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: DiscordMcpUrl,
            description: "Discord MCP",
          },
        ]
      : [],
  compileBinding: compileDiscordBinding,
};
