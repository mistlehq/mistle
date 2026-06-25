import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GoogleWorkspaceBindingConfigSchema } from "./binding-config-schema.js";
import { GoogleWorkspaceMcpServerIds } from "./mcp-catalog.js";

describe("GoogleWorkspaceBindingConfigSchema", () => {
  it("defaults to no selected Google Workspace MCP servers", () => {
    expect(GoogleWorkspaceBindingConfigSchema.parse({})).toEqual({
      mcpServers: [],
      workspaceUserEmail: "",
    });
  });

  it("emits the optional Workspace user email as a single string field in JSON Schema validation", () => {
    const jsonSchema = z.toJSONSchema(GoogleWorkspaceBindingConfigSchema);

    expect(jsonSchema).toMatchObject({
      properties: {
        workspaceUserEmail: {
          default: "",
          type: "string",
        },
      },
    });
    expect(jsonSchema.properties?.workspaceUserEmail).not.toHaveProperty("anyOf");
  });

  it("accepts selected Google Workspace MCP servers", () => {
    expect(
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: [
          GoogleWorkspaceMcpServerIds.GMAIL,
          GoogleWorkspaceMcpServerIds.DRIVE,
          GoogleWorkspaceMcpServerIds.SHEETS,
          GoogleWorkspaceMcpServerIds.DOCS,
          GoogleWorkspaceMcpServerIds.SLIDES,
          GoogleWorkspaceMcpServerIds.CALENDAR,
        ],
      }),
    ).toEqual({
      mcpServers: [
        GoogleWorkspaceMcpServerIds.GMAIL,
        GoogleWorkspaceMcpServerIds.DRIVE,
        GoogleWorkspaceMcpServerIds.SHEETS,
        GoogleWorkspaceMcpServerIds.DOCS,
        GoogleWorkspaceMcpServerIds.SLIDES,
        GoogleWorkspaceMcpServerIds.CALENDAR,
      ],
      workspaceUserEmail: "",
    });
  });

  it("treats a blank Workspace user email as the empty default", () => {
    expect(
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: [GoogleWorkspaceMcpServerIds.DRIVE],
        workspaceUserEmail: "  ",
      }),
    ).toEqual({
      mcpServers: [GoogleWorkspaceMcpServerIds.DRIVE],
      workspaceUserEmail: "",
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

  it("rejects an invalid Workspace user email", () => {
    expect(() =>
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: [GoogleWorkspaceMcpServerIds.DRIVE],
        workspaceUserEmail: "not-an-email",
      }),
    ).toThrow("Workspace user email must be a valid email address.");
  });

  it("rejects unsupported and duplicate Google Workspace MCP server ids", () => {
    expect(() =>
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: ["unsupported"],
      }),
    ).toThrow("Unsupported Google Workspace tool id 'unsupported'.");

    expect(() =>
      GoogleWorkspaceBindingConfigSchema.parse({
        mcpServers: [GoogleWorkspaceMcpServerIds.GMAIL, GoogleWorkspaceMcpServerIds.GMAIL],
      }),
    ).toThrow("Duplicate Google Workspace tool id 'gmail'.");
  });
});
