import { describe, expect, it } from "vitest";

import { GitHubCloudBindingConfigSchema } from "./binding-config-schema.js";

describe("GitHubCloudBindingConfigSchema", () => {
  it("defaults repositories to an empty list", () => {
    const parsed = GitHubCloudBindingConfigSchema.parse({});

    expect(parsed).toEqual({
      repositories: [],
      tools: [],
    });
  });

  it("parses a valid git binding config", () => {
    const parsed = GitHubCloudBindingConfigSchema.parse({
      repositories: ["acme/backend", "acme/frontend"],
    });

    expect(parsed).toEqual({
      repositories: ["acme/backend", "acme/frontend"],
      tools: [],
    });
  });

  it("fails when repositories are not owner/repo values", () => {
    expect(() =>
      GitHubCloudBindingConfigSchema.parse({
        repositories: ["acme"],
      }),
    ).toThrow("Repository must be in <owner>/<repo> format.");
  });
});
