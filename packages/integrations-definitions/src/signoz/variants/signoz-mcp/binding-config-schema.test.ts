import { describe, expect, it } from "vitest";

import { SignozBindingConfigSchema } from "./binding-config-schema.js";

describe("SignozBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(SignozBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });
});
