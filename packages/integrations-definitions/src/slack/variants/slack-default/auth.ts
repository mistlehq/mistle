import { z } from "zod";

export const SlackBotTokenConnectionMethodId = "slack-bot-token";
export const SlackApiKeySecretType = "api_key";
export const SlackBotTokenSlotKey = "slack.slack-default.slack-bot-token.bot-token";
export const SlackSigningSecretSlotKey = "slack.slack-default.slack-bot-token.signing-secret";

export const SlackConnectionMethodIds = {
  SLACK_BOT_TOKEN: SlackBotTokenConnectionMethodId,
};

export const SlackCredentialSecretTypes = {
  API_KEY: SlackApiKeySecretType,
};

export const SlackCredentialSlotKeys = {
  BOT_TOKEN: SlackBotTokenSlotKey,
  SIGNING_SECRET: SlackSigningSecretSlotKey,
};

export const SlackBotTokenConnectionConfigSchema = z
  .object({
    connection_method: z.literal(SlackBotTokenConnectionMethodId),
  })
  .strict();

export type SlackConnectionConfig = z.output<typeof SlackBotTokenConnectionConfigSchema>;
