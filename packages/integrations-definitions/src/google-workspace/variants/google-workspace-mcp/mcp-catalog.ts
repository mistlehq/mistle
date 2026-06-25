import type { RemoteMcpServerCatalogEntry } from "../../../shared/remote-mcp-server-catalog/index.js";

export const GoogleWorkspaceMcpServerIds: {
  GMAIL: "gmail";
  DRIVE: "drive";
  SHEETS: "sheets";
  DOCS: "docs";
  SLIDES: "slides";
  CALENDAR: "calendar";
  CHAT: "chat";
  PEOPLE: "people";
} = {
  GMAIL: "gmail",
  DRIVE: "drive",
  SHEETS: "sheets",
  DOCS: "docs",
  SLIDES: "slides",
  CALENDAR: "calendar",
  CHAT: "chat",
  PEOPLE: "people",
};

export type GoogleWorkspaceMcpServerId =
  (typeof GoogleWorkspaceMcpServerIds)[keyof typeof GoogleWorkspaceMcpServerIds];

type GoogleWorkspaceMcpServerCatalogEntry = {
  id: GoogleWorkspaceMcpServerId;
  displayName: string;
  description: string;
};

type GoogleWorkspaceRemoteMcpServerCatalogEntry = GoogleWorkspaceMcpServerCatalogEntry & {
  url: string;
};

export const GoogleWorkspaceLocalGwsToolIds: ReadonlyArray<GoogleWorkspaceMcpServerId> = [
  GoogleWorkspaceMcpServerIds.DRIVE,
  GoogleWorkspaceMcpServerIds.SHEETS,
  GoogleWorkspaceMcpServerIds.DOCS,
  GoogleWorkspaceMcpServerIds.SLIDES,
];

export const GoogleWorkspaceRemoteMcpServerCatalog: ReadonlyArray<GoogleWorkspaceRemoteMcpServerCatalogEntry> =
  [
    {
      id: GoogleWorkspaceMcpServerIds.GMAIL,
      displayName: "Gmail",
      url: "https://gmailmcp.googleapis.com/mcp/v1",
      description: "Google Workspace Gmail MCP",
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

export const GoogleWorkspaceRemoteMcpServerEntries: ReadonlyArray<RemoteMcpServerCatalogEntry> =
  GoogleWorkspaceRemoteMcpServerCatalog;

export const GoogleWorkspaceMcpServerCatalog: ReadonlyArray<GoogleWorkspaceMcpServerCatalogEntry> =
  [
    ...GoogleWorkspaceRemoteMcpServerCatalog,
    {
      id: GoogleWorkspaceMcpServerIds.DRIVE,
      displayName: "Google Drive",
      description: "Google Drive tools served by the local gws MCP server.",
    },
    {
      id: GoogleWorkspaceMcpServerIds.SHEETS,
      displayName: "Google Sheets",
      description: "Google Sheets tools served by the local gws MCP server.",
    },
    {
      id: GoogleWorkspaceMcpServerIds.DOCS,
      displayName: "Google Docs",
      description: "Google Docs tools served by the local gws MCP server.",
    },
    {
      id: GoogleWorkspaceMcpServerIds.SLIDES,
      displayName: "Google Slides",
      description: "Google Slides tools served by the local gws MCP server.",
    },
  ];
