import { describe, expect, it } from "vitest";

import {
  OpenComputerSandboxRuntimeBindingConfigSchema,
  OpenComputerSandboxRuntimeConnectionConfigSchema,
} from "./schemas.js";

describe("OpenComputerSandboxRuntimeConnectionConfigSchema", () => {
  it("accepts the persisted API key connection method", () => {
    expect(
      OpenComputerSandboxRuntimeConnectionConfigSchema.parse({
        connection_method: "api-key",
      }),
    ).toEqual({
      connection_method: "api-key",
    });
  });
});

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
