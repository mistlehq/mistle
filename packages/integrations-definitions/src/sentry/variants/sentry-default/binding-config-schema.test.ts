import { describe, expect, it } from "vitest";

import { SentryBindingConfigSchema } from "./binding-config-schema.js";

describe("SentryBindingConfigSchema", () => {
  it("defaults optional tool selections to Sentry MCP", () => {
    expect(SentryBindingConfigSchema.parse({})).toEqual({
      tools: ["sentry-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      SentryBindingConfigSchema.parse({
        tools: ["sentry-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
