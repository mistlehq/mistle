import type { RemoteMcpServerCatalogEntry } from "../../../shared/remote-mcp-server-catalog/index.js";

export const GoogleWorkspaceMcpServerIds: {
  GMAIL: "gmail";
  DRIVE: "drive";
  CALENDAR: "calendar";
  CHAT: "chat";
  PEOPLE: "people";
} = {
  GMAIL: "gmail",
  DRIVE: "drive",
  CALENDAR: "calendar",
  CHAT: "chat",
  PEOPLE: "people",
};

export const GoogleWorkspaceMcpServerCatalog: ReadonlyArray<RemoteMcpServerCatalogEntry> = [
  {
    id: GoogleWorkspaceMcpServerIds.GMAIL,
    displayName: "Gmail",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    description: "Google Workspace Gmail MCP",
  },
  {
    id: GoogleWorkspaceMcpServerIds.DRIVE,
    displayName: "Google Drive",
    url: "https://drivemcp.googleapis.com/mcp/v1",
    description: "Google Workspace Drive MCP",
  },
  {
    id: GoogleWorkspaceMcpServerIds.CALENDAR,
    displayName: "Google Calendar",
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    description: "Google Workspace Calendar MCP",
  },
  {
    id: GoogleWorkspaceMcpServerIds.CHAT,
    displayName: "Google Chat",
    url: "https://chatmcp.googleapis.com/mcp/v1",
    description: "Google Workspace Chat MCP",
  },
  {
    id: GoogleWorkspaceMcpServerIds.PEOPLE,
    displayName: "People API",
    url: "https://people.googleapis.com/mcp/v1",
    description: "Google Workspace People MCP",
  },
];
