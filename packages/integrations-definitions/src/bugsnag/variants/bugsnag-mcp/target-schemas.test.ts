import { describe, expect, it } from "vitest";

import { BugSnagTargetConfigSchema } from "./target-config-schema.js";
import { BugSnagTargetSecretSchema } from "./target-secret-schema.js";

describe("BugSnag target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(BugSnagTargetConfigSchema.parse({})).toEqual({});
    expect(BugSnagTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => BugSnagTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/u,
    );
    expect(() => BugSnagTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
