import { describe, expect, it } from "vitest";

import { JiraBindingConfigSchema } from "./binding-config-schema.js";

describe("JiraBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(JiraBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });
});
