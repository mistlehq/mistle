import { describe, expect, it } from "vitest";

import { PlanetScaleBindingConfigSchema } from "./binding-config-schema.js";

describe("PlanetScaleBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(PlanetScaleBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });
});
