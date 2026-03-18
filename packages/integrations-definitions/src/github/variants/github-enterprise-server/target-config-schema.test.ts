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

  it("parses optional github app metadata", () => {
    const parsed = GitHubEnterpriseServerTargetConfigSchema.parse({
      api_base_url: "https://ghe.example.com/api/v3",
      web_base_url: "https://ghe.example.com",
      app_id: "9999",
      app_slug: "mistle-enterprise-app",
      client_id: "Iv1.enterprise",
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://ghe.example.com/api/v3",
      webBaseUrl: "https://ghe.example.com",
      appId: "9999",
      appSlug: "mistle-enterprise-app",
      clientId: "Iv1.enterprise",
    });
  });

  it("fails for invalid URL fields", () => {
    expect(() =>
      GitHubEnterpriseServerTargetConfigSchema.parse({
        api_base_url: "https://ghe.example.com/api/v3",
        web_base_url: "not-a-url",
      }),
    ).toThrow();
  });
});
