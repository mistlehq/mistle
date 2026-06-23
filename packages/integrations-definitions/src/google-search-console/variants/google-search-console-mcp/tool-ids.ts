export const GoogleSearchConsoleCliToolId = "google-search-console-cli";
export const GoogleSearchConsoleMcpToolId = "google-search-console-mcp";

export const GoogleSearchConsoleToolIds = {
  GOOGLE_SEARCH_CONSOLE_CLI: GoogleSearchConsoleCliToolId,
  GOOGLE_SEARCH_CONSOLE_MCP: GoogleSearchConsoleMcpToolId,
};

export type GoogleSearchConsoleToolId =
  (typeof GoogleSearchConsoleToolIds)[keyof typeof GoogleSearchConsoleToolIds];
