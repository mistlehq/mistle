import { describe, expect, it } from "vitest";

import { validateFreestyleSandboxConfig } from "./config.js";

describe("validateFreestyleSandboxConfig", () => {
  it("accepts an api key with optional provider settings", () => {
    expect(
      validateFreestyleSandboxConfig({
        apiKey: "test-api-key",
        baseUrl: "https://api.freestyle.sh",
        idleTimeoutSeconds: 600,
      }),
    ).toEqual({
      apiKey: "test-api-key",
      baseUrl: "https://api.freestyle.sh",
      idleTimeoutSeconds: 600,
    });
  });

  it("rejects empty api keys", () => {
    expect(() => validateFreestyleSandboxConfig({ apiKey: "" })).toThrow(
      "Freestyle config field `apiKey` is required.",
    );
  });

  it("rejects invalid base urls", () => {
    expect(() =>
      validateFreestyleSandboxConfig({
        apiKey: "test-api-key",
        baseUrl: "not a url",
      }),
    ).toThrow("Invalid URL");
  });
});
