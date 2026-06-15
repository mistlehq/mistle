import { describe, expect, it } from "vitest";

import { PostHogBindingConfigSchema } from "./binding-config-schema.js";

describe("PostHogBindingConfigSchema", () => {
  it("defaults optional tool selections to PostHog MCP", () => {
    expect(PostHogBindingConfigSchema.parse({})).toEqual({
      tools: ["posthog-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      PostHogBindingConfigSchema.parse({
        tools: ["posthog-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
