export const ShopifyToolIds = {
  SHOPIFY_CLI: "shopify-cli",
  SHOPIFY_MCP: "shopify-mcp",
} as const;

export type ShopifyToolId = (typeof ShopifyToolIds)[keyof typeof ShopifyToolIds];
