import { describe, expect, it } from "vitest";

import { AutumnBindingConfigSchema } from "./binding-config-schema.js";
import { AutumnMcpServerIds } from "./mcp-catalog.js";

describe("AutumnBindingConfigSchema", () => {
  it("defaults Autumn MCP on", () => {
    expect(AutumnBindingConfigSchema.parse({})).toEqual({
      mcpServers: [AutumnMcpServerIds.AUTUMN],
    });
  });

  it("validates selected Autumn MCP server ids", () => {
    expect(
      AutumnBindingConfigSchema.parse({
        mcpServers: [AutumnMcpServerIds.AUTUMN],
      }),
    ).toEqual({
      mcpServers: [AutumnMcpServerIds.AUTUMN],
    });
    expect(() =>
      AutumnBindingConfigSchema.parse({
        mcpServers: ["unknown_server"],
      }),
    ).toThrow("Unsupported remote MCP server id 'unknown_server'.");
    expect(() =>
      AutumnBindingConfigSchema.parse({
        mcpServers: [AutumnMcpServerIds.AUTUMN, AutumnMcpServerIds.AUTUMN],
      }),
    ).toThrow("Duplicate remote MCP server id 'autumn'.");
  });
});
