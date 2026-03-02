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

  it("parses optional github app metadata", () => {
    const parsed = GitHubCloudTargetConfigSchema.parse({
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
      app_id: 12345,
      client_id: "Iv1.abc123",
    });

    expect(parsed).toEqual({
      apiBaseUrl: "https://api.github.com/",
      webBaseUrl: "https://github.com/",
      appId: "12345",
      clientId: "Iv1.abc123",
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
