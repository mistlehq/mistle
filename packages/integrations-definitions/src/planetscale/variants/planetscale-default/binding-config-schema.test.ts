import { describe, expect, it } from "vitest";

import { PlanetScaleBindingConfigSchema } from "./binding-config-schema.js";
import { PlanetScaleToolIds } from "./tool-ids.js";

describe("PlanetScaleBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(PlanetScaleBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts all supported PlanetScale tools together", () => {
    expect(
      PlanetScaleBindingConfigSchema.parse({
        tools: [
          PlanetScaleToolIds.PLANETSCALE_CLI,
          PlanetScaleToolIds.PLANETSCALE_MCP,
          PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
        ],
      }),
    ).toEqual({
      tools: [
        PlanetScaleToolIds.PLANETSCALE_CLI,
        PlanetScaleToolIds.PLANETSCALE_MCP,
        PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
      ],
    });
  });

  it("rejects unknown tools", () => {
    const parsed = PlanetScaleBindingConfigSchema.safeParse({
      tools: ["planetscale-shell"],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected unknown PlanetScale tool selection to fail validation.");
    }

    expect(parsed.error.issues[0]?.message).toContain("Invalid option");
  });
});
