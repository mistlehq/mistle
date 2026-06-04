export const SlackCliToolId = "slack-cli";
export const SlackMcpToolId = "slack-mcp";

export const SlackToolIds = {
  SLACK_CLI: SlackCliToolId,
  SLACK_MCP: SlackMcpToolId,
};

export type SlackToolId = (typeof SlackToolIds)[keyof typeof SlackToolIds];
