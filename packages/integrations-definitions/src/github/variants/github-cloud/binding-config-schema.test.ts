import { describe, expect, it } from "vitest";

import { GitHubCloudBindingConfigSchema } from "./binding-config-schema.js";

describe("GitHubCloudBindingConfigSchema", () => {
  it("parses a valid git binding config", () => {
    const parsed = GitHubCloudBindingConfigSchema.parse({
      repositories: ["acme/backend", "acme/frontend"],
      includeGhCli: true,
    });

    expect(parsed).toEqual({
      repositories: ["acme/backend", "acme/frontend"],
      includeGhCli: true,
    });
  });

  it("fails when repositories are not owner/repo values", () => {
    expect(() =>
      GitHubCloudBindingConfigSchema.parse({
        repositories: ["acme"],
        includeGhCli: true,
      }),
    ).toThrowError();
  });

  it("fails when includeGhCli is missing", () => {
    expect(() =>
      GitHubCloudBindingConfigSchema.parse({
        repositories: ["acme/backend"],
      }),
    ).toThrowError();
  });
});
