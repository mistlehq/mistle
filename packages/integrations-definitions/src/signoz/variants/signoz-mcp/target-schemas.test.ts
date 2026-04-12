import { describe, expect, it } from "vitest";

import { SignozTargetConfigSchema } from "./target-config-schema.js";
import { SignozTargetSecretSchema } from "./target-secret-schema.js";

describe("Signoz target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(SignozTargetConfigSchema.parse({})).toEqual({});
    expect(SignozTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config fields", () => {
    expect(() => SignozTargetConfigSchema.parse({ unexpected: true })).toThrow(/Unrecognized key/u);
    expect(() => SignozTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
