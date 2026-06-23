import { describe, expect, it } from "vitest";

import { KlaviyoBindingConfigSchema } from "./binding-config-schema.js";

describe("KlaviyoBindingConfigSchema", () => {
  it("defaults optional tool selections to Klaviyo MCP", () => {
    expect(KlaviyoBindingConfigSchema.parse({})).toEqual({
      tools: ["klaviyo-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      KlaviyoBindingConfigSchema.parse({
        tools: ["klaviyo-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
