import { describe, expect, it } from "vitest";

import { GcpBindingConfigSchema } from "./binding-config-schema.js";
import { GcpMcpServerIds } from "./mcp-catalog.js";

describe("GcpBindingConfigSchema", () => {
  it("defaults optional MCP server selections to an empty array", () => {
    expect(GcpBindingConfigSchema.parse({})).toEqual({
      mcpServers: [],
    });
  });

  it("accepts supported Google Cloud MCP server ids", () => {
    expect(
      GcpBindingConfigSchema.parse({
        mcpServers: [GcpMcpServerIds.CLOUD_STORAGE, GcpMcpServerIds.CLOUD_RESOURCE_MANAGER],
      }),
    ).toEqual({
      mcpServers: [GcpMcpServerIds.CLOUD_STORAGE, GcpMcpServerIds.CLOUD_RESOURCE_MANAGER],
    });
  });

  it("rejects unsupported Google Cloud MCP server ids", () => {
    expect(() =>
      GcpBindingConfigSchema.parse({
        mcpServers: [GcpMcpServerIds.CLOUD_STORAGE, "unknown_server"],
      }),
    ).toThrow("Unsupported remote MCP server id 'unknown_server'.");
  });
});
