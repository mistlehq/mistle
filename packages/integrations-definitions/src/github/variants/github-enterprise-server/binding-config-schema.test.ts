import { describe, expect, it } from "vitest";

import { GitHubEnterpriseServerBindingConfigSchema } from "./binding-config-schema.js";

describe("GitHubEnterpriseServerBindingConfigSchema", () => {
  it("parses a valid git binding config", () => {
    const parsed = GitHubEnterpriseServerBindingConfigSchema.parse({
      repositories: ["acme/backend", "acme/frontend"],
      includeGhCli: false,
    });

    expect(parsed).toEqual({
      repositories: ["acme/backend", "acme/frontend"],
      includeGhCli: false,
    });
  });

  it("fails when repositories are not owner/repo values", () => {
    expect(() =>
      GitHubEnterpriseServerBindingConfigSchema.parse({
        repositories: ["acme"],
        includeGhCli: false,
      }),
    ).toThrowError();
  });

  it("fails when includeGhCli is missing", () => {
    expect(() =>
      GitHubEnterpriseServerBindingConfigSchema.parse({
        repositories: ["acme/backend"],
      }),
    ).toThrowError();
  });
});
