import { describe, expect, it } from "vitest";

import { TensorlakeSandboxRuntimeBindingConfigSchema } from "./schemas.js";

describe("TensorlakeSandboxRuntimeBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(TensorlakeSandboxRuntimeBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts Tensorlake CLI tool selection", () => {
    expect(
      TensorlakeSandboxRuntimeBindingConfigSchema.parse({
        tools: ["tensorlake-cli"],
      }),
    ).toEqual({
      tools: ["tensorlake-cli"],
    });
  });
});
