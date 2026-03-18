import { describe, expect, it } from "vitest";

import { resolveGitHubCredentialSecretType } from "./auth.js";

describe("github shared auth", () => {
  it("resolves api-key connections to api_key secret type", () => {
    const secretType = resolveGitHubCredentialSecretType({
      connection_method: "api-key",
    });

    expect(secretType).toBe("api_key");
  });

  it("resolves oauth connections to oauth_access_token secret type", () => {
    const secretType = resolveGitHubCredentialSecretType({
      connection_method: "github-app-installation",
      installation_id: 12345,
    });

    expect(secretType).toBe("oauth_access_token");
  });

  it("fails when connection_method is missing", () => {
    expect(() => resolveGitHubCredentialSecretType({})).toThrowError();
  });

  it("fails when GitHub App installation_id is missing", () => {
    expect(() =>
      resolveGitHubCredentialSecretType({
        connection_method: "github-app-installation",
      }),
    ).toThrowError();
  });
});
