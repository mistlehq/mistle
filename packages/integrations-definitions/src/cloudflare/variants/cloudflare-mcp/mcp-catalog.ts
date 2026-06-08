import type { RemoteMcpServerCatalogEntry } from "../../../shared/remote-mcp-server-catalog/index.js";

export const CloudflareMcpServerIds: {
  CLOUDFLARE_API: "cloudflare_api";
} = {
  CLOUDFLARE_API: "cloudflare_api",
};

export const CloudflareMcpServerCatalog: ReadonlyArray<RemoteMcpServerCatalogEntry> = [
  {
    id: CloudflareMcpServerIds.CLOUDFLARE_API,
    displayName: "Cloudflare API MCP",
    url: "https://mcp.cloudflare.com/mcp",
    description: "Cloudflare API MCP Code Mode",
  },
];
