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
  GoogleWorkspaceMcpServerIds.GMAIL,
  GoogleWorkspaceMcpServerIds.DRIVE,
  GoogleWorkspaceMcpServerIds.SHEETS,
  GoogleWorkspaceMcpServerIds.DOCS,
  GoogleWorkspaceMcpServerIds.SLIDES,
  GoogleWorkspaceMcpServerIds.CALENDAR,
  GoogleWorkspaceMcpServerIds.CHAT,
  GoogleWorkspaceMcpServerIds.PEOPLE,
];

export const GoogleWorkspaceRemoteMcpServerCatalog: ReadonlyArray<GoogleWorkspaceRemoteMcpServerCatalogEntry> =
  [];

export const GoogleWorkspaceRemoteMcpServerEntries: ReadonlyArray<RemoteMcpServerCatalogEntry> =
  GoogleWorkspaceRemoteMcpServerCatalog;

export const GoogleWorkspaceMcpServerCatalog: ReadonlyArray<GoogleWorkspaceMcpServerCatalogEntry> =
  [
    {
      id: GoogleWorkspaceMcpServerIds.GMAIL,
      displayName: "Gmail",
      description: "Gmail tools served by the local gws MCP server.",
    },
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
    {
      id: GoogleWorkspaceMcpServerIds.CALENDAR,
      displayName: "Google Calendar",
      description: "Google Calendar tools served by the local gws MCP server.",
    },
    {
      id: GoogleWorkspaceMcpServerIds.CHAT,
      displayName: "Google Chat",
      description: "Google Chat tools served by the local gws MCP server.",
    },
    {
      id: GoogleWorkspaceMcpServerIds.PEOPLE,
      displayName: "People API",
      description: "People API tools served by the local gws MCP server.",
    },
  ];
