import type { RemoteMcpServerCatalogEntry } from "../../../shared/remote-mcp-server-catalog/index.js";
import { ExpoMcpUrl } from "./auth.js";

export const ExpoMcpServerIds: {
  EXPO: "expo";
} = {
  EXPO: "expo",
};

export const ExpoMcpServerCatalog: ReadonlyArray<RemoteMcpServerCatalogEntry> = [
  {
    id: ExpoMcpServerIds.EXPO,
    displayName: "Expo MCP",
    url: ExpoMcpUrl,
    description: "Expo MCP Server",
  },
];
