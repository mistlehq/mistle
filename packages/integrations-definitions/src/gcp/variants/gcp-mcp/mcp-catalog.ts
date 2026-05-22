import type { RemoteMcpServerCatalogEntry } from "../../../shared/remote-mcp-server-catalog/index.js";

export const GcpMcpServerIds: {
  CLOUD_STORAGE: "cloud_storage";
  CLOUD_RESOURCE_MANAGER: "cloud_resource_manager";
} = {
  CLOUD_STORAGE: "cloud_storage",
  CLOUD_RESOURCE_MANAGER: "cloud_resource_manager",
};

export const GcpMcpServerCatalog: ReadonlyArray<RemoteMcpServerCatalogEntry> = [
  {
    id: GcpMcpServerIds.CLOUD_STORAGE,
    displayName: "Cloud Storage",
    url: "https://storage.googleapis.com/storage/mcp",
    description: "Google Cloud Storage MCP",
  },
  {
    id: GcpMcpServerIds.CLOUD_RESOURCE_MANAGER,
    displayName: "Cloud Resource Manager",
    url: "https://cloudresourcemanager.googleapis.com/mcp",
    description: "Google Cloud Resource Manager MCP",
  },
];
