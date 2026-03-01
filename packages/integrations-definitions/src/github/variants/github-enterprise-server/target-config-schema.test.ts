import { describe, expect, it } from "vitest";

import { GitHubEnterpriseServerTargetConfigSchema } from "./target-config-schema.js";

describe("GitHubEnterpriseServerTargetConfigSchema", () => {
  it("normalizes trailing slashes on non-root paths", () => {
    const parsed = GitHubEnterpriseServerTargetConfigSchema.parse({
      api_base_url: "https://ghe.example.com/api/v3/",
      web_base_url: "https://ghe.example.com/",
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://ghe.example.com/api/v3",
      webBaseUrl: "https://ghe.example.com/",
    });
  });

  it("fails for invalid URL fields", () => {
    expect(() =>
      GitHubEnterpriseServerTargetConfigSchema.parse({
        api_base_url: "https://ghe.example.com/api/v3",
        web_base_url: "not-a-url",
      }),
    ).toThrowError();
  });
});
