import { describe, expect, it } from "vitest";

import { CloudflareBindingConfigSchema } from "./binding-config-schema.js";
import { CloudflareMcpServerIds } from "./mcp-catalog.js";

describe("CloudflareBindingConfigSchema", () => {
  it("defaults Cloudflare API MCP Code Mode on", () => {
    expect(CloudflareBindingConfigSchema.parse({})).toEqual({
      mcpServers: [CloudflareMcpServerIds.CLOUDFLARE_API],
    });
  });

  it("validates selected Cloudflare MCP server ids", () => {
    expect(
      CloudflareBindingConfigSchema.parse({
        mcpServers: [CloudflareMcpServerIds.CLOUDFLARE_API],
      }),
    ).toEqual({
      mcpServers: [CloudflareMcpServerIds.CLOUDFLARE_API],
    });
    expect(() =>
      CloudflareBindingConfigSchema.parse({
        mcpServers: ["unknown_server"],
      }),
    ).toThrow("Unsupported remote MCP server id 'unknown_server'.");
    expect(() =>
      CloudflareBindingConfigSchema.parse({
        mcpServers: [CloudflareMcpServerIds.CLOUDFLARE_API, CloudflareMcpServerIds.CLOUDFLARE_API],
      }),
    ).toThrow("Duplicate remote MCP server id 'cloudflare_api'.");
  });
});
