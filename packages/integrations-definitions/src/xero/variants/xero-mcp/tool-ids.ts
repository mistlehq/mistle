export const XeroToolIds = {
  XERO_MCP: "xero-mcp",
} as const;

export type XeroToolId = (typeof XeroToolIds)[keyof typeof XeroToolIds];
