import { describe, expect, it } from "vitest";

import {
  RenderTargetConfigSchema,
  RenderMcpBaseUrl,
  resolveRenderMcpUrl,
} from "./target-config-schema.js";

describe("RenderTargetConfigSchema", () => {
  it("accepts empty target config", () => {
    expect(RenderTargetConfigSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config fields", () => {
    expect(() =>
      RenderTargetConfigSchema.parse({
        mcp_base_url: RenderMcpBaseUrl,
      }),
    ).toThrow(/Unrecognized key/u);
  });

  it("resolves the hosted MCP server URL", () => {
    expect(resolveRenderMcpUrl()).toBe("https://mcp.render.com/mcp");
  });
});
