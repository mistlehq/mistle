import { z } from "zod";

export const TelegramFamilyId = "telegram";
export const TelegramDefaultVariantId = "telegram-default";
export const TelegramConnectionMethodId = "telegram-bot";
export const TelegramApiKeySecretType = "api_key";
export const TelegramBotTokenSlotKey = "telegram.telegram-default.telegram-bot.bot-token";

export const TelegramCredentialSecretTypes = {
  API_KEY: TelegramApiKeySecretType,
};

export const TelegramCredentialSlotKeys = {
  BOT_TOKEN: TelegramBotTokenSlotKey,
};

export const TelegramConnectionConfigSchema = z
  .object({
    connection_method: z.literal(TelegramConnectionMethodId),
  })
  .strict();

export type TelegramConnectionConfig = z.output<typeof TelegramConnectionConfigSchema>;
