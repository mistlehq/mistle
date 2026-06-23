import { describe, expect, it } from "vitest";

import { GoogleBusinessProfileTargetConfigSchema } from "./target-config-schema.js";
import { GoogleBusinessProfileTargetSecretSchema } from "./target-secret-schema.js";

describe("Google Business Profile target schemas", () => {
  it("accepts empty target config and rejects unknown config fields", () => {
    expect(GoogleBusinessProfileTargetConfigSchema.parse({})).toEqual({});
    expect(() =>
      GoogleBusinessProfileTargetConfigSchema.parse({ api_base_url: "https://example.com" }),
    ).toThrow(/Unrecognized key/u);
  });

  it("accepts empty target secrets and rejects unknown secret fields", () => {
    expect(GoogleBusinessProfileTargetSecretSchema.parse({})).toEqual({});
    expect(() => GoogleBusinessProfileTargetSecretSchema.parse({ token: "secret" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
