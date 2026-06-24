import { describe, expect, it } from "vitest";

import { DataForSeoBindingConfigSchema } from "./binding-config-schema.js";

describe("DataForSeoBindingConfigSchema", () => {
  it("defaults optional tool selections to DataForSEO MCP", () => {
    expect(DataForSeoBindingConfigSchema.parse({})).toEqual({
      tools: ["dataforseo-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      DataForSeoBindingConfigSchema.parse({
        tools: ["dataforseo-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
