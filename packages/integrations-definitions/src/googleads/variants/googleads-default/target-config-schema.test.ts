import { describe, expect, it } from "vitest";

import { GoogleAdsTargetConfigSchema, resolveGoogleAdsBaseUrl } from "./target-config-schema.js";

describe("GoogleAdsTargetConfigSchema", () => {
  it("defaults to the released CLI Google Ads API version", () => {
    expect(GoogleAdsTargetConfigSchema.parse({})).toEqual({
      api_version: "v24",
    });
  });

  it("rejects unversioned API target config", () => {
    expect(() =>
      GoogleAdsTargetConfigSchema.parse({
        api_version: "24",
      }),
    ).toThrow("Google Ads API version must use v<major> format.");
  });

  it("builds the versioned Google Ads API base URL", () => {
    expect(resolveGoogleAdsBaseUrl("v24")).toBe("https://googleads.googleapis.com/v24");
  });
});
