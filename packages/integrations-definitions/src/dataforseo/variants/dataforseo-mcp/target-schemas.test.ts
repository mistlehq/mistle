import { describe, expect, it } from "vitest";

import { DataForSeoTargetConfigSchema } from "./target-config-schema.js";
import { DataForSeoTargetSecretSchema } from "./target-secret-schema.js";

describe("DataForSeo target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(DataForSeoTargetConfigSchema.parse({})).toEqual({});
    expect(DataForSeoTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => DataForSeoTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/u,
    );
    expect(() => DataForSeoTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
