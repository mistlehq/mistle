import { describe, expect, it } from "vitest";

import { StripeTargetConfigSchema } from "./target-config-schema.js";
import { StripeTargetSecretSchema } from "./target-secret-schema.js";

describe("Stripe target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(StripeTargetConfigSchema.parse({})).toEqual({});
    expect(StripeTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => StripeTargetConfigSchema.parse({ unexpected: true })).toThrow(/Unrecognized key/u);
    expect(() => StripeTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
