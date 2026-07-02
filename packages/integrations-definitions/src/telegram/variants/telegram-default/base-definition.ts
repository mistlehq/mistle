import {
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type TelegramConnectionConfig,
  TelegramConnectionConfigSchema,
  TelegramConnectionMethodId,
  TelegramCredentialSecretTypes,
  TelegramCredentialSlotKeys,
  TelegramDefaultVariantId,
  TelegramFamilyId,
} from "./auth.js";
import { resolveTelegramBindingConfigForm } from "./binding-config-form.js";
import { TelegramBindingConfigSchema } from "./binding-config-schema.js";
import { compileTelegramBinding, TelegramMcpUrl } from "./compile-binding.js";
import { TelegramConnectionConfigForm } from "./connection-config-form.js";
import { TelegramSupportedWebhookEvents } from "./supported-webhook-events.js";
import { TelegramTargetConfigSchema } from "./target-config-schema.js";
import { TelegramTargetSecretSchema } from "./target-secret-schema.js";
import { TelegramToolIds } from "./tool-ids.js";

export type TelegramBaseIntegrationDefinition = IntegrationDefinition<
  typeof TelegramTargetConfigSchema,
  typeof TelegramTargetSecretSchema,
  typeof TelegramBindingConfigSchema,
  TelegramConnectionConfig
>;

export const TelegramBaseDefinition: TelegramBaseIntegrationDefinition = {
  familyId: TelegramFamilyId,
  variantId: TelegramDefaultVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Telegram",
  description: "Enable access to Telegram Bot API operations and local Telegram MCP tools.",
  logoKey: "telegram",
  targetConfigSchema: TelegramTargetConfigSchema,
  targetSecretSchema: TelegramTargetSecretSchema,
  bindingConfigSchema: TelegramBindingConfigSchema,
  bindingConfigForm: resolveTelegramBindingConfigForm,
  connectionMethods: [
    {
      id: TelegramConnectionMethodId,
      label: "Telegram bot",
      kind: "form",
      secretFields: [
        {
          name: "botToken",
          label: "Bot token",
          placeholder: "Enter bot token",
          description: "Telegram bot token from BotFather.",
          inputType: "password",
          secretType: TelegramCredentialSecretTypes.API_KEY,
          slotKey: TelegramCredentialSlotKeys.BOT_TOKEN,
        },
      ],
      configSchema: TelegramConnectionConfigSchema,
      configForm: TelegramConnectionConfigForm,
    },
  ],
  supportedWebhookEvents: TelegramSupportedWebhookEvents,
  mcp: (input) =>
    input.binding.config.tools.includes(TelegramToolIds.TELEGRAM_MCP)
      ? [
          {
            serverId: TelegramToolIds.TELEGRAM_MCP,
            serverName: "telegram",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: TelegramMcpUrl,
            description: "Telegram MCP",
          },
        ]
      : [],
  compileBinding: compileTelegramBinding,
};
