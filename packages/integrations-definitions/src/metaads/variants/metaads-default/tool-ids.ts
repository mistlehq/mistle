export const MetaAdsToolIds = {
  METAADS_CLI: "metaads-cli",
  METAADS_MCP: "metaads-mcp",
} as const;

export type MetaAdsToolId = (typeof MetaAdsToolIds)[keyof typeof MetaAdsToolIds];
