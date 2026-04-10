import { describe, expect, it } from "vitest";

import { LinearBindingConfigSchema } from "./binding-config-schema.js";
import { LinearToolIds } from "./tool-ids.js";

describe("LinearBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(LinearBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts the Linear MCP tool selection", () => {
    expect(
      LinearBindingConfigSchema.parse({
        tools: [LinearToolIds.LINEAR_MCP],
      }),
    ).toEqual({
      tools: [LinearToolIds.LINEAR_MCP],
    });
  });

  it("rejects unknown tools", () => {
    const parsed = LinearBindingConfigSchema.safeParse({
      tools: ["linear-cli"],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected unknown Linear tool selection to fail validation.");
    }

    expect(parsed.error.issues[0]?.message).toBe('Invalid input: expected "linear-mcp"');
  });
});
