import { describe, expect, it } from "vitest";

import { ExpoBindingConfigSchema } from "./binding-config-schema.js";
import { ExpoMcpServerIds } from "./mcp-catalog.js";

describe("ExpoBindingConfigSchema", () => {
  it("defaults optional remote MCP server selection to Expo MCP", () => {
    expect(ExpoBindingConfigSchema.parse({})).toEqual({
      mcpServers: [ExpoMcpServerIds.EXPO],
    });
  });

  it("rejects unknown remote MCP server ids", () => {
    expect(() =>
      ExpoBindingConfigSchema.parse({
        mcpServers: ["unknown_expo_server"],
      }),
    ).toThrow("Unsupported remote MCP server id 'unknown_expo_server'.");
  });
});
