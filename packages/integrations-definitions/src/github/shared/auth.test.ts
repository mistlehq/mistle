import { describe, expect, it } from "vitest";

import {
  parseGitHubAppInstallationConnectionConfig,
  resolveGitHubCredentialSecretType,
} from "./auth.js";

describe("github shared auth", () => {
  it("resolves api-key connections to api_key secret type", () => {
    const secretType = resolveGitHubCredentialSecretType({
      connection_method: "api-key",
    });

    expect(secretType).toBe("api_key");
  });

  it("resolves GitHub App installation connections to github_app_installation_token", () => {
    const secretType = resolveGitHubCredentialSecretType({
      connection_method: "github-app-installation",
      app_id: "123",
      app_slug: "mistle-github-app",
      installation_id: 12345,
    });

    expect(secretType).toBe("github_app_installation_token");
  });

  it("fails when connection_method is missing", () => {
    expect(() => resolveGitHubCredentialSecretType({})).toThrow(/Invalid input/);
  });

  it("allows GitHub App connections before installation is complete", () => {
    const secretType = resolveGitHubCredentialSecretType({
      connection_method: "github-app-installation",
      app_id: "123",
      app_slug: "mistle-github-app",
    });

    expect(secretType).toBe("github_app_installation_token");
  });

  it("normalizes numeric GitHub App identifiers to strings", () => {
    const config = parseGitHubAppInstallationConnectionConfig({
      connection_method: "github-app-installation",
      app_id: 123,
      app_slug: "mistle-github-app",
      client_id: "Iv1.client123",
      installation_id: 456,
    });

    expect(config).toEqual({
      connection_method: "github-app-installation",
      app_id: "123",
      app_slug: "mistle-github-app",
      client_id: "Iv1.client123",
      installation_id: "456",
    });
  });
});
