import { describe, expect, it } from "vitest";

import { ExpoTargetConfigSchema } from "./target-config-schema.js";
import { ExpoTargetSecretSchema } from "./target-secret-schema.js";

describe("Expo target schemas", () => {
  it("accept empty target config and secrets", () => {
    expect(ExpoTargetConfigSchema.parse({})).toEqual({});
    expect(ExpoTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret keys", () => {
    expect(() => ExpoTargetConfigSchema.parse({ unexpected: true })).toThrow(/Unrecognized key/u);
    expect(() => ExpoTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
