import type { RemoteMcpServerCatalogEntry } from "../../../shared/remote-mcp-server-catalog/index.js";

export const GcpMcpServerIds: {
  CLOUD_LOGGING: "cloud_logging";
  CLOUD_RUN: "cloud_run";
  CLOUD_STORAGE: "cloud_storage";
  CLOUD_RESOURCE_MANAGER: "cloud_resource_manager";
  GKE: "gke";
} = {
  CLOUD_LOGGING: "cloud_logging",
  CLOUD_RUN: "cloud_run",
  CLOUD_STORAGE: "cloud_storage",
  CLOUD_RESOURCE_MANAGER: "cloud_resource_manager",
  GKE: "gke",
};

export const GcpMcpServerCatalog: ReadonlyArray<RemoteMcpServerCatalogEntry> = [
  {
    id: GcpMcpServerIds.CLOUD_LOGGING,
    displayName: "Cloud Logging",
    url: "https://logging.googleapis.com/mcp",
    description: "Google Cloud Logging MCP",
  },
  {
    id: GcpMcpServerIds.CLOUD_RUN,
    displayName: "Cloud Run",
    url: "https://run.googleapis.com/mcp",
    description: "Google Cloud Run MCP",
  },
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
  {
    id: GcpMcpServerIds.GKE,
    displayName: "Google Kubernetes Engine",
    url: "https://container.googleapis.com/mcp",
    description: "Google Kubernetes Engine MCP",
  },
];
