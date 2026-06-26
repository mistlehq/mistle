export const DiscordCliToolId = "discord-cli";
export const DiscordMcpToolId = "discord-mcp";

export const DiscordToolIds = {
  DISCORD_CLI: DiscordCliToolId,
  DISCORD_MCP: DiscordMcpToolId,
};

export type DiscordToolId = (typeof DiscordToolIds)[keyof typeof DiscordToolIds];
