import type { RemoteMcpServerCatalogEntry } from "../../../shared/remote-mcp-server-catalog/index.js";

export const AutumnMcpServerIds: {
  AUTUMN: "autumn";
} = {
  AUTUMN: "autumn",
};

export const AutumnMcpServerCatalog: ReadonlyArray<RemoteMcpServerCatalogEntry> = [
  {
    id: AutumnMcpServerIds.AUTUMN,
    displayName: "Autumn MCP",
    url: "https://mcp.useautumn.com/mcp",
    description: "Autumn billing, customer, plan, balance, and log MCP access",
  },
];
