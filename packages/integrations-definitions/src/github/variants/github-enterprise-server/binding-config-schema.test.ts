import { describe, expect, it } from "vitest";

import { GitHubEnterpriseServerBindingConfigSchema } from "./binding-config-schema.js";

describe("GitHubEnterpriseServerBindingConfigSchema", () => {
  it("parses a valid git binding config", () => {
    const parsed = GitHubEnterpriseServerBindingConfigSchema.parse({
      repositories: ["acme/backend", "acme/frontend"],
    });

    expect(parsed).toEqual({
      repositories: ["acme/backend", "acme/frontend"],
    });
  });

  it("fails when repositories are not owner/repo values", () => {
    expect(() =>
      GitHubEnterpriseServerBindingConfigSchema.parse({
        repositories: ["acme"],
      }),
    ).toThrow();
  });
});
