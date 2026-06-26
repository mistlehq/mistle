import { describe, expect, it } from "vitest";

import {
  TensorlakeSandboxRuntimeBindingConfigSchema,
  TensorlakeSandboxRuntimeConnectionConfigSchema,
} from "./schemas.js";

describe("TensorlakeSandboxRuntimeConnectionConfigSchema", () => {
  it("accepts the persisted API key connection method", () => {
    expect(
      TensorlakeSandboxRuntimeConnectionConfigSchema.parse({
        connection_method: "api-key",
      }),
    ).toEqual({
      connection_method: "api-key",
    });
  });
});

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
