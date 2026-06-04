import { describe, expect, it } from "vitest";

import { SlackBindingConfigSchema } from "./binding-config-schema.js";

describe("SlackBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(SlackBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts Slack CLI and MCP tool selections", () => {
    expect(
      SlackBindingConfigSchema.parse({
        tools: ["slack-cli", "slack-mcp"],
      }),
    ).toEqual({
      tools: ["slack-cli", "slack-mcp"],
    });
  });
});
