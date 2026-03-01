import { describe, expect, it } from "vitest";

import { GitHubSupportedAuthSchemes, resolveGitHubCredentialSecretType } from "./auth.js";

describe("github shared auth", () => {
  it("supports both api-key and oauth auth schemes", () => {
    expect(GitHubSupportedAuthSchemes).toEqual(["api-key", "oauth"]);
  });

  it("resolves api-key connections to api_key secret type", () => {
    const secretType = resolveGitHubCredentialSecretType({
      auth_scheme: "api-key",
    });

    expect(secretType).toBe("api_key");
  });

  it("resolves oauth connections to oauth_access_token secret type", () => {
    const secretType = resolveGitHubCredentialSecretType({
      auth_scheme: "oauth",
      installation_id: 12345,
    });

    expect(secretType).toBe("oauth_access_token");
  });

  it("fails when auth_scheme is missing", () => {
    expect(() => resolveGitHubCredentialSecretType({})).toThrowError();
  });

  it("fails when oauth installation_id is missing", () => {
    expect(() =>
      resolveGitHubCredentialSecretType({
        auth_scheme: "oauth",
      }),
    ).toThrowError();
  });
});
