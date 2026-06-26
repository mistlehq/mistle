import { ProviderConfigurationSetupCompletedConfigKey } from "@mistle/integrations-core";
import { z } from "zod";

export const DiscordFamilyId = "discord";
export const DiscordDefaultVariantId = "discord-default";
export const DiscordConnectionMethodId = "discord-bot";
export const DiscordApiKeySecretType = "api_key";
export const DiscordBotTokenSlotKey = "discord.discord-default.discord-bot.bot-token";
export const DiscordPublicKeySlotKey = "discord.discord-default.discord-bot.public-key";

export const DiscordConnectionMethodIds = {
  DISCORD_BOT: DiscordConnectionMethodId,
};

export const DiscordCredentialSecretTypes = {
  API_KEY: DiscordApiKeySecretType,
};

export const DiscordCredentialSlotKeys = {
  BOT_TOKEN: DiscordBotTokenSlotKey,
  PUBLIC_KEY: DiscordPublicKeySlotKey,
};

export const DiscordConnectionConfigSchema = z
  .object({
    connection_method: z.literal(DiscordConnectionMethodId),
    application_id: z.string().min(1).optional(),
    [ProviderConfigurationSetupCompletedConfigKey]: z.string().min(1).optional(),
  })
  .strict();

export type DiscordConnectionConfig = z.output<typeof DiscordConnectionConfigSchema>;
