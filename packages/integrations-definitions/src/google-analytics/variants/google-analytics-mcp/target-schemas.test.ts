import { describe, expect, it } from "vitest";

import { GoogleAnalyticsTargetConfigSchema } from "./target-config-schema.js";
import { GoogleAnalyticsTargetSecretSchema } from "./target-secret-schema.js";

describe("Google Analytics target schemas", () => {
  it("accepts empty target config and rejects unknown config fields", () => {
    expect(GoogleAnalyticsTargetConfigSchema.parse({})).toEqual({});
    expect(() =>
      GoogleAnalyticsTargetConfigSchema.parse({ api_base_url: "https://example.com" }),
    ).toThrow(/Unrecognized key/u);
  });

  it("accepts empty target secrets and rejects unknown secret fields", () => {
    expect(GoogleAnalyticsTargetSecretSchema.parse({})).toEqual({});
    expect(() => GoogleAnalyticsTargetSecretSchema.parse({ token: "secret" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
