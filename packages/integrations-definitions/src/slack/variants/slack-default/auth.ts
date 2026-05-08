import { z } from "zod";

export const SlackConnectionMethodId = "slack-bot-token";
export const SlackApiKeySecretType = "api_key";
export const SlackBotTokenSlotKey = "slack.slack-default.slack-bot-token.bot-token";
export const SlackSigningSecretSlotKey = "slack.slack-default.slack-bot-token.signing-secret";
export const SlackClientSecretSlotKey = "slack.slack-default.slack-bot-token.client-secret";
export const SlackOAuthClientSecretType = "oauth2_client_secret";

export const SlackConnectionMethodIds = {
  SLACK_APP: SlackConnectionMethodId,
};

export const SlackCredentialSecretTypes = {
  API_KEY: SlackApiKeySecretType,
  OAUTH2_CLIENT_SECRET: SlackOAuthClientSecretType,
};

export const SlackCredentialSlotKeys = {
  BOT_TOKEN: SlackBotTokenSlotKey,
  SIGNING_SECRET: SlackSigningSecretSlotKey,
  CLIENT_SECRET: SlackClientSecretSlotKey,
};

export const SlackAppConnectionConfigSchema = z
  .object({
    connection_method: z.literal(SlackConnectionMethodId),
    app_id: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
  })
  .strict();

export const SlackConnectionConfigSchema = SlackAppConnectionConfigSchema;

export type SlackConnectionConfig = z.output<typeof SlackConnectionConfigSchema>;
