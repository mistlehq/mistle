export const SlackCliToolId = "slack-cli";

export const SlackToolIds = {
  SLACK_CLI: SlackCliToolId,
};

export type SlackToolId = (typeof SlackToolIds)[keyof typeof SlackToolIds];
