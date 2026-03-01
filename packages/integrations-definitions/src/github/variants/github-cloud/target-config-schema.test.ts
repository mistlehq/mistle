import { describe, expect, it } from "vitest";

import { GitHubCloudTargetConfigSchema } from "./target-config-schema.js";

describe("GitHubCloudTargetConfigSchema", () => {
  it("normalizes trailing slashes on non-root paths", () => {
    const parsed = GitHubCloudTargetConfigSchema.parse({
      api_base_url: "https://proxy.example.com/github/api/",
      web_base_url: "https://github.example.com/",
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://proxy.example.com/github/api",
      webBaseUrl: "https://github.example.com/",
    });
  });

  it("fails for invalid URL fields", () => {
    expect(() =>
      GitHubCloudTargetConfigSchema.parse({
        api_base_url: "not-a-url",
        web_base_url: "https://github.com",
      }),
    ).toThrowError();
  });
});
