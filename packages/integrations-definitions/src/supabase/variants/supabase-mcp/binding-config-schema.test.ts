import { describe, expect, it } from "vitest";

import { SupabaseBindingConfigSchema } from "./binding-config-schema.js";

describe("SupabaseBindingConfigSchema", () => {
  it("defaults optional tool selections to Supabase MCP", () => {
    expect(SupabaseBindingConfigSchema.parse({})).toEqual({
      tools: ["supabase-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      SupabaseBindingConfigSchema.parse({
        tools: ["supabase-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
