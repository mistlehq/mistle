import { describe, expect, it } from "vitest";

import { MetaAdsTargetConfigSchema, resolveMetaAdsGraphBaseUrl } from "./target-config-schema.js";

describe("MetaAdsTargetConfigSchema", () => {
  it("defaults to the released CLI Graph API version", () => {
    expect(MetaAdsTargetConfigSchema.parse({})).toEqual({
      graph_api_version: "v25.0",
    });
  });

  it("rejects unversioned Graph API target config", () => {
    expect(() =>
      MetaAdsTargetConfigSchema.parse({
        graph_api_version: "25.0",
      }),
    ).toThrow("Meta Ads Graph API version must use v<major>.<minor> format.");
  });

  it("builds the versioned Meta Graph API base URL", () => {
    expect(resolveMetaAdsGraphBaseUrl("v25.0")).toBe("https://graph.facebook.com/v25.0");
  });
});
