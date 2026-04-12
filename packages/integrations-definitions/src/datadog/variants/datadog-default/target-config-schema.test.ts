import { describe, expect, it } from "vitest";

import {
  DatadogTargetConfigSchema,
  DatadogMcpBaseUrl,
  resolveDatadogMcpUrl,
} from "./target-config-schema.js";

describe("DatadogTargetConfigSchema", () => {
  it("accepts empty target config", () => {
    expect(DatadogTargetConfigSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config fields", () => {
    expect(() =>
      DatadogTargetConfigSchema.parse({
        mcp_base_url: DatadogMcpBaseUrl,
      }),
    ).toThrow(/Unrecognized key/u);
  });

  it("appends toolsets=all to the MCP server URL", () => {
    expect(resolveDatadogMcpUrl()).toBe(
      "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp?toolsets=all",
    );
  });
});
