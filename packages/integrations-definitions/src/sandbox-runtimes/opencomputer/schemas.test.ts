import { describe, expect, it } from "vitest";

import { OpenComputerSandboxRuntimeBindingConfigSchema } from "./schemas.js";

describe("OpenComputerSandboxRuntimeBindingConfigSchema", () => {
  it("defaults optional tool selections to an empty array", () => {
    expect(OpenComputerSandboxRuntimeBindingConfigSchema.parse({})).toEqual({
      tools: [],
    });
  });

  it("accepts OpenComputer CLI tool selection", () => {
    expect(
      OpenComputerSandboxRuntimeBindingConfigSchema.parse({
        tools: ["opencomputer-cli"],
      }),
    ).toEqual({
      tools: ["opencomputer-cli"],
    });
  });
});
