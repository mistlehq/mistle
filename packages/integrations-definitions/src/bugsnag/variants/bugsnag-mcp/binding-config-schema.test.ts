import { describe, expect, it } from "vitest";

import { BugSnagBindingConfigSchema } from "./binding-config-schema.js";

describe("BugSnagBindingConfigSchema", () => {
  it("defaults optional tool selections to BugSnag MCP", () => {
    expect(BugSnagBindingConfigSchema.parse({})).toEqual({
      tools: ["bugsnag-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      BugSnagBindingConfigSchema.parse({
        tools: ["bugsnag-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
