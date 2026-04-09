import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { validateE2BSandboxConfig } from "./config.js";
import { E2BDefaultTemplateCpuCount, E2BDefaultTemplateMemoryMb } from "./schemas.js";

describe("validateE2BSandboxConfig", () => {
  it("returns config with defaults when optional resource settings are omitted", () => {
    const config = validateE2BSandboxConfig({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
    });

    expect(config).toEqual({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
      cpuCount: E2BDefaultTemplateCpuCount,
      memoryMb: E2BDefaultTemplateMemoryMb,
    });
  });

  it("returns config when explicit resource settings are provided", () => {
    const config = validateE2BSandboxConfig({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
      cpuCount: 4,
      memoryMb: 16384,
    });

    expect(config).toEqual({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
      cpuCount: 4,
      memoryMb: 16384,
    });
  });

  it("throws when api key is empty", () => {
    expect(() =>
      validateE2BSandboxConfig({
        apiKey: "",
      }),
    ).toThrow(ZodError);
  });

  it("throws when domain is empty", () => {
    expect(() =>
      validateE2BSandboxConfig({
        apiKey: "test-api-key",
        domain: "  ",
      }),
    ).toThrow(ZodError);
  });
});
