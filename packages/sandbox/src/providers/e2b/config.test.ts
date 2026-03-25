import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { validateE2BSandboxConfig } from "./config.js";

describe("validateE2BSandboxConfig", () => {
  it("returns config when all required fields are non-empty", () => {
    const config = validateE2BSandboxConfig({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
    });

    expect(config).toEqual({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
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
