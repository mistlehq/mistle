import { describe, expect, it } from "vitest";

import { GcpTargetConfigSchema } from "./target-config-schema.js";
import { GcpTargetSecretSchema } from "./target-secret-schema.js";

describe("GCP target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(GcpTargetConfigSchema.parse({})).toEqual({});
    expect(GcpTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and target secret fields", () => {
    expect(() => GcpTargetConfigSchema.parse({ unexpected: true })).toThrow(/Unrecognized key/);
    expect(() => GcpTargetSecretSchema.parse({ unexpected: "value" })).toThrow(/Unrecognized key/);
  });
});
