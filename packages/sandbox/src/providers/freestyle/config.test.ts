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

  it("accepts a release sandboxd artifact source for base image preparation", () => {
    expect(
      validateFreestyleSandboxConfig({
        apiKey: "test-api-key",
        sandboxd: {
          kind: "release",
          artifact: {
            version: "1.2.3",
            url: "https://github.com/mistlehq/mistle/releases/download/v1.2.3/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
            sha256: "a".repeat(64),
          },
        },
      }),
    ).toMatchObject({
      sandboxd: {
        kind: "release",
        artifact: {
          version: "1.2.3",
        },
      },
    });
  });
});
