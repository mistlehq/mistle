import { describe, expect, it } from "vitest";

import { KlaviyoTargetConfigSchema } from "./target-config-schema.js";
import { KlaviyoTargetSecretSchema } from "./target-secret-schema.js";

describe("Klaviyo target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(KlaviyoTargetConfigSchema.parse({})).toEqual({});
    expect(KlaviyoTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => KlaviyoTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/u,
    );
    expect(() => KlaviyoTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
