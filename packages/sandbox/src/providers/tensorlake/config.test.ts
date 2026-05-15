import { describe, expect, it } from "vitest";

import { validateTensorlakeSandboxConfig } from "./config.js";

describe("validateTensorlakeSandboxConfig", () => {
  it("accepts only an api key", () => {
    expect(validateTensorlakeSandboxConfig({ apiKey: "test-api-key" })).toEqual({
      apiKey: "test-api-key",
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
