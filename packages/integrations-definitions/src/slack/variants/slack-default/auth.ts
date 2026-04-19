import { z } from "zod";

export const SlackBotTokenConnectionMethodId = "slack-bot-token";
export const SlackAppOAuthConnectionMethodId = "slack-app-oauth";
export const SlackApiKeySecretType = "api_key";
export const SlackBotTokenSlotKey = "slack.slack-default.slack-bot-token.bot-token";
export const SlackSigningSecretSlotKey = "slack.slack-default.slack-bot-token.signing-secret";
export const SlackClientSecretSlotKey = "slack.slack-default.slack-app-oauth.client-secret";
export const SlackOAuthClientSecretType = "oauth2_client_secret";

export const SlackConnectionMethodIds = {
  SLACK_BOT_TOKEN: SlackBotTokenConnectionMethodId,
  SLACK_APP_OAUTH: SlackAppOAuthConnectionMethodId,
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

export const SlackBotTokenConnectionConfigSchema = z
  .object({
    connection_method: z.literal(SlackBotTokenConnectionMethodId),
  })
  .strict();

export const SlackAppOAuthConnectionConfigSchema = z
  .object({
    connection_method: z.literal(SlackAppOAuthConnectionMethodId),
    client_id: z.string().min(1),
  })
  .strict();

export const SlackConnectionConfigSchema = z.discriminatedUnion("connection_method", [
  SlackBotTokenConnectionConfigSchema,
  SlackAppOAuthConnectionConfigSchema,
]);

export type SlackConnectionConfig = z.output<typeof SlackConnectionConfigSchema>;

export function parseSlackConnectionConfig(input: Record<string, unknown>): SlackConnectionConfig {
  return SlackConnectionConfigSchema.parse(input);
}
