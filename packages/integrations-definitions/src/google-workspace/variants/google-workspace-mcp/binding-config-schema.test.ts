import { describe, expect, it } from "vitest";

import { GoogleWorkspaceBindingConfigSchema } from "./binding-config-schema.js";
import { GoogleWorkspaceMcpServerIds } from "./mcp-catalog.js";

describe("GoogleWorkspaceBindingConfigSchema", () => {
  it("accepts selected Google Workspace MCP servers", () => {
    expect(
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: [GoogleWorkspaceMcpServerIds.GMAIL, GoogleWorkspaceMcpServerIds.CALENDAR],
      }),
    ).toEqual({
      mcpServers: [GoogleWorkspaceMcpServerIds.GMAIL, GoogleWorkspaceMcpServerIds.CALENDAR],
    });
  });

  it("treats a blank Workspace user email as omitted", () => {
    expect(
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: [GoogleWorkspaceMcpServerIds.DRIVE],
        workspaceUserEmail: "  ",
      }),
    ).toEqual({
      mcpServers: [GoogleWorkspaceMcpServerIds.DRIVE],
    });
  });

  it("trims a Workspace user email before storing it", () => {
    expect(
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: [GoogleWorkspaceMcpServerIds.DRIVE],
        workspaceUserEmail: "  workspace-user@example.com  ",
      }),
    ).toEqual({
      mcpServers: [GoogleWorkspaceMcpServerIds.DRIVE],
      workspaceUserEmail: "workspace-user@example.com",
    });
  });

  it("rejects unsupported and duplicate Google Workspace MCP server ids", () => {
    expect(() =>
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: ["unsupported"],
      }),
    ).toThrow("Unsupported remote MCP server id 'unsupported'.");

    expect(() =>
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: [GoogleWorkspaceMcpServerIds.GMAIL, GoogleWorkspaceMcpServerIds.GMAIL],
      }),
    ).toThrow("Duplicate remote MCP server id 'gmail'.");
  });
});
