import { describe, expect, it } from "vitest";

import { GitHubAppInstallationCredentialResolver } from "./credential-resolver.js";

describe("GitHubAppInstallationCredentialResolver", () => {
  it("fails fast when secret type is unsupported", async () => {
    await expect(
      GitHubAppInstallationCredentialResolver.resolve({
        organizationId: "org_123",
        targetKey: "github-cloud",
        connectionId: "icn_123",
        secretType: "api_key",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            apiBaseUrl: "https://api.github.com",
            webBaseUrl: "https://github.com",
            appId: "12345",
          },
          secrets: {
            appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----",
          },
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            auth_scheme: "oauth",
            installation_id: "98765",
          },
        },
      }),
    ).rejects.toThrowError(
      "GitHub app installation resolver only supports 'oauth_access_token' secret type.",
    );
  });

  it("fails fast when target config is missing app_id", async () => {
    await expect(
      GitHubAppInstallationCredentialResolver.resolve({
        organizationId: "org_123",
        targetKey: "github-cloud",
        connectionId: "icn_123",
        secretType: "oauth_access_token",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            apiBaseUrl: "https://api.github.com",
            webBaseUrl: "https://github.com",
          },
          secrets: {
            appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----",
          },
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            auth_scheme: "oauth",
            installation_id: "98765",
          },
        },
      }),
    ).rejects.toThrowError("GitHub app installation resolver requires target config `app_id`.");
  });

  it("fails fast when target secrets are missing app_private_key_pem", async () => {
    await expect(
      GitHubAppInstallationCredentialResolver.resolve({
        organizationId: "org_123",
        targetKey: "github-cloud",
        connectionId: "icn_123",
        secretType: "oauth_access_token",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            apiBaseUrl: "https://api.github.com",
            webBaseUrl: "https://github.com",
            appId: "12345",
          },
          secrets: {},
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            auth_scheme: "oauth",
            installation_id: "98765",
          },
        },
      }),
    ).rejects.toThrowError(
      "GitHub app installation resolver requires target secret `app_private_key_pem`.",
    );
  });

  it("fails fast when connection config is not oauth", async () => {
    await expect(
      GitHubAppInstallationCredentialResolver.resolve({
        organizationId: "org_123",
        targetKey: "github-cloud",
        connectionId: "icn_123",
        secretType: "oauth_access_token",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            apiBaseUrl: "https://api.github.com",
            webBaseUrl: "https://github.com",
            appId: "12345",
          },
          secrets: {
            appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----",
          },
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            auth_scheme: "api-key",
          },
        },
      }),
    ).rejects.toThrowError("GitHub app installation resolver requires an OAuth connection config.");
  });
});
