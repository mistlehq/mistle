import { describe, expect, it } from "vitest";

import { buildCompletedGitHubAppManifestResult } from "./provider-app-setup.server.js";

const GitHubManifestConversion = {
  id: "123",
  slug: "mistle-github-app",
  client_id: "Iv1.client123",
  client_secret: "github-client-secret",
  pem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
  webhook_secret: "github-webhook-secret",
} as const;

describe("buildCompletedGitHubAppManifestResult", () => {
  it("returns an installed connection-detail redirect when the manifest callback includes installation fields", () => {
    const result = buildCompletedGitHubAppManifestResult({
      conversion: GitHubManifestConversion,
      query: new URLSearchParams({
        installation_id: "12345",
        setup_action: "install",
      }),
      supportsClientSecret: true,
    });

    expect(result).toEqual({
      completionRedirect: {
        kind: "connection-detail",
        notice: "installed",
      },
      connection: {
        externalSubjectId: "12345",
        config: {
          connection_method: "github-app-installation",
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
          installation_id: "12345",
          setup_action: "install",
        },
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        clientSecret: "github-client-secret",
        webhookSecret: "github-webhook-secret",
      },
    });
  });

  it("returns the setup-route created state when the manifest callback does not include installation fields", () => {
    const result = buildCompletedGitHubAppManifestResult({
      conversion: GitHubManifestConversion,
      query: new URLSearchParams(),
      supportsClientSecret: true,
    });

    expect(result).toEqual({
      completionRedirect: {
        kind: "setup-route",
        query: {
          githubAppManifest: "created",
        },
      },
      connection: {
        config: {
          connection_method: "github-app-installation",
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
        },
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        clientSecret: "github-client-secret",
        webhookSecret: "github-webhook-secret",
      },
    });
  });
});
