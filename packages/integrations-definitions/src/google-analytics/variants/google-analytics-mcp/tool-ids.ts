export const GoogleAnalyticsCliToolId = "google-analytics-cli";
export const GoogleAnalyticsMcpToolId = "google-analytics-mcp";

export const GoogleAnalyticsToolIds = {
  GOOGLE_ANALYTICS_CLI: GoogleAnalyticsCliToolId,
  GOOGLE_ANALYTICS_MCP: GoogleAnalyticsMcpToolId,
};

export type GoogleAnalyticsToolId =
  (typeof GoogleAnalyticsToolIds)[keyof typeof GoogleAnalyticsToolIds];
