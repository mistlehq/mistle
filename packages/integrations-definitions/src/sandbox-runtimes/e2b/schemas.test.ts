import { describe, expect, it } from "vitest";

import { E2BSandboxRuntimeBindingConfigSchema } from "./schemas.js";

describe("E2BSandboxRuntimeBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(E2BSandboxRuntimeBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts E2B CLI tool selection", () => {
    expect(
      E2BSandboxRuntimeBindingConfigSchema.parse({
        tools: ["e2b-cli"],
      }),
    ).toEqual({
      tools: ["e2b-cli"],
    });
  });
});
