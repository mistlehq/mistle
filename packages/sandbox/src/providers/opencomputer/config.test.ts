import { describe, expect, it } from "vitest";

import { validateOpenComputerSandboxConfig } from "./config.js";

describe("validateOpenComputerSandboxConfig", () => {
  it("accepts API key config", () => {
    expect(validateOpenComputerSandboxConfig({ apiKey: "oc-test-key" })).toEqual({
      apiKey: "oc-test-key",
    });
  });

  it("accepts sandboxd release artifact config", () => {
    expect(
      validateOpenComputerSandboxConfig({
        apiKey: "oc-test-key",
        apiBaseUrl: "https://app.opencomputer.dev/api",
        sandboxd: {
          kind: "release",
          artifact: {
            version: "0.32.0",
            target: "x86_64-unknown-linux-gnu",
            url: "https://example.com/sandboxd.tar.gz",
            sha256: "a".repeat(64),
          },
        },
      }),
    ).toMatchObject({
      apiKey: "oc-test-key",
      apiBaseUrl: "https://app.opencomputer.dev/api",
    });
  });

  it("rejects empty API keys and malformed artifact checksums", () => {
    expect(() => validateOpenComputerSandboxConfig({ apiKey: "" })).toThrow(
      "OpenComputer config field `apiKey` is required.",
    );
    expect(() =>
      validateOpenComputerSandboxConfig({
        apiKey: "oc-test-key",
        sandboxd: {
          kind: "release",
          artifact: {
            version: "0.32.0",
            url: "https://example.com/sandboxd.tar.gz",
            sha256: "not-a-sha",
          },
        },
      }),
    ).toThrow("Invalid string");
  });
});
