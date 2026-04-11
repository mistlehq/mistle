import { describe, expect, it } from "vitest";

import { PlanetScaleTargetConfigSchema } from "./target-config-schema.js";
import { PlanetScaleTargetSecretSchema } from "./target-secret-schema.js";

describe("PlanetScale target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(PlanetScaleTargetConfigSchema.parse({})).toEqual({});
    expect(PlanetScaleTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config fields", () => {
    expect(() => PlanetScaleTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/,
    );
    expect(() => PlanetScaleTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/,
    );
  });
});
