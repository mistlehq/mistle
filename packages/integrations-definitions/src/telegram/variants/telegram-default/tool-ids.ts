export const TelegramCliToolId = "telegram-cli";
export const TelegramMcpToolId = "telegram-mcp";

export const TelegramToolIds = {
  TELEGRAM_CLI: TelegramCliToolId,
  TELEGRAM_MCP: TelegramMcpToolId,
};

export type TelegramToolId = (typeof TelegramToolIds)[keyof typeof TelegramToolIds];
