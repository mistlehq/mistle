import { describe, expect, it } from "vitest";

import { GitHubEnterpriseServerTargetConfigSchema } from "./target-config-schema.js";

describe("GitHubEnterpriseServerTargetConfigSchema", () => {
  it("normalizes trailing slashes on root and non-root paths", () => {
    const parsed = GitHubEnterpriseServerTargetConfigSchema.parse({
      api_base_url: "https://ghe.example.com/api/v3/",
      web_base_url: "https://ghe.example.com/",
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://ghe.example.com/api/v3",
      webBaseUrl: "https://ghe.example.com",
    });
  });

  it("rejects legacy github app metadata on the target", () => {
    expect(() =>
      GitHubEnterpriseServerTargetConfigSchema.parse({
        api_base_url: "https://ghe.example.com/api/v3",
        web_base_url: "https://ghe.example.com",
        client_id: "Iv1.enterprise",
      }),
    ).toThrow(/Unrecognized key/u);
  });

  it("fails for invalid URL fields", () => {
    expect(() =>
      GitHubEnterpriseServerTargetConfigSchema.parse({
        api_base_url: "https://ghe.example.com/api/v3",
        web_base_url: "not-a-url",
      }),
    ).toThrow(/Invalid URL/);
  });
});
