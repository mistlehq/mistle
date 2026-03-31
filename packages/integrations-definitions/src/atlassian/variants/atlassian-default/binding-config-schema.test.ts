import { describe, expect, it } from "vitest";

import { AtlassianBindingConfigSchema } from "./binding-config-schema.js";

describe("AtlassianBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(AtlassianBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });
});
