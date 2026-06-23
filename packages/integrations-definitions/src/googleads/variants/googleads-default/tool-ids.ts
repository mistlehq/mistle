export const GoogleAdsToolIds: {
  GOOGLEADS_CLI: "googleads-cli";
  GOOGLEADS_MCP: "googleads-mcp";
} = {
  GOOGLEADS_CLI: "googleads-cli",
  GOOGLEADS_MCP: "googleads-mcp",
};

export type GoogleAdsToolId = (typeof GoogleAdsToolIds)[keyof typeof GoogleAdsToolIds];
