import { describe, expect, it } from "vitest";

import { RailwayTargetConfigSchema } from "./target-config-schema.js";
import { RailwayTargetSecretSchema } from "./target-secret-schema.js";

describe("Railway target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(RailwayTargetConfigSchema.parse({})).toEqual({});
    expect(RailwayTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => RailwayTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/u,
    );
    expect(() => RailwayTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
