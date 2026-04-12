import { describe, expect, it } from "vitest";

import {
  DatadogTargetConfigSchema,
  DefaultDatadogMcpBaseUrl,
  resolveDatadogMcpUrl,
} from "./target-config-schema.js";

describe("DatadogTargetConfigSchema", () => {
  it("defaults to the Datadog US MCP base URL", () => {
    expect(DatadogTargetConfigSchema.parse({})).toEqual({
      mcpBaseUrl: DefaultDatadogMcpBaseUrl,
    });
  });

  it("normalizes trailing slashes and strips query and hash fragments", () => {
    expect(
      DatadogTargetConfigSchema.parse({
        mcp_base_url:
          "https://mcp.us3.datadoghq.com/api/unstable/mcp-server/mcp/?toolsets=logs#ignored",
      }),
    ).toEqual({
      mcpBaseUrl: "https://mcp.us3.datadoghq.com/api/unstable/mcp-server/mcp",
    });
  });

  it("appends toolsets=all to the MCP server URL", () => {
    expect(resolveDatadogMcpUrl("https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp")).toBe(
      "https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp?toolsets=all",
    );
  });
});
