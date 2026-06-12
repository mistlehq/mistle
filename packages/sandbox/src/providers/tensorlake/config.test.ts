import { describe, expect, it } from "vitest";

import { validateTensorlakeSandboxConfig } from "./config.js";

describe("validateTensorlakeSandboxConfig", () => {
  it("accepts only an api key", () => {
    expect(validateTensorlakeSandboxConfig({ apiKey: "test-api-key" })).toEqual({
      apiKey: "test-api-key",
    });
  });

  it("accepts a release sandboxd artifact source for missing-image registration", () => {
    expect(
      validateTensorlakeSandboxConfig({
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

  it("rejects extra provider-level sandbox creation options", () => {
    const config = {
      apiKey: "test-api-key",
      cpus: 2,
    };

    expect(() => validateTensorlakeSandboxConfig(config)).toThrow(/Unrecognized key/);
  });
});
