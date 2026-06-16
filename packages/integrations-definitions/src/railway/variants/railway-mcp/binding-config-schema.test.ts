import { describe, expect, it } from "vitest";

import { RailwayBindingConfigSchema } from "./binding-config-schema.js";

describe("RailwayBindingConfigSchema", () => {
  it("defaults optional tool selections to Railway MCP", () => {
    expect(RailwayBindingConfigSchema.parse({})).toEqual({
      tools: ["railway-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      RailwayBindingConfigSchema.parse({
        tools: ["railway-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
