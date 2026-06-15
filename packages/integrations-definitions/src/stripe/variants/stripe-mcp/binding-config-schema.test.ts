import { describe, expect, it } from "vitest";

import { StripeBindingConfigSchema } from "./binding-config-schema.js";

describe("StripeBindingConfigSchema", () => {
  it("defaults optional tool selections to Stripe MCP", () => {
    expect(StripeBindingConfigSchema.parse({})).toEqual({
      tools: ["stripe-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      StripeBindingConfigSchema.parse({
        tools: ["stripe-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
