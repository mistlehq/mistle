import { describe, expect, it } from "vitest";

import { GitHubAppInstallationRedirectHandler } from "./github-app-installation-handler.js";

describe("GitHubAppInstallationRedirectHandler", () => {
  it("builds github cloud install url with state", async () => {
    const started = await GitHubAppInstallationRedirectHandler.start({
      organizationId: "org_123",
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        secrets: {},
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com/",
          appSlug: "mistle-app",
        },
      },
      state: "state_123",
    });

    expect(started.authorizationUrl).toBe(
      "https://github.com/apps/mistle-app/installations/new?state=state_123",
    );
  });

  it("builds github enterprise server install url with state", async () => {
    const started = await GitHubAppInstallationRedirectHandler.start({
      organizationId: "org_123",
      targetKey: "github_enterprise_server",
      target: {
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: true,
        secrets: {},
        config: {
          apiBaseUrl: "https://ghe.example.com/api/v3",
          webBaseUrl: "https://ghe.example.com/",
          appSlug: "mistle-app-enterprise",
        },
      },
      state: "state_456",
    });

    expect(started.authorizationUrl).toBe(
      "https://ghe.example.com/apps/mistle-app-enterprise/installations/new?state=state_456",
    );
  });

  it("fails fast when app slug is missing", async () => {
    await expect(async () =>
      GitHubAppInstallationRedirectHandler.start({
        organizationId: "org_123",
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          secrets: {},
          config: {
            apiBaseUrl: "https://api.github.com/",
            webBaseUrl: "https://github.com/",
          },
        },
        state: "state_123",
      }),
    ).rejects.toThrow("GitHub App installation flow requires `app_slug` in target config.");
  });

  it("maps callback installation id into GitHub App installation connection config", async () => {
    const completed = await GitHubAppInstallationRedirectHandler.complete({
      organizationId: "org_123",
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        secrets: {},
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com/",
          appSlug: "mistle-app",
        },
      },
      query: new URLSearchParams({
        installation_id: "98765",
        setup_action: "install",
      }),
    });

    expect(completed).toEqual({
      externalSubjectId: "98765",
      connectionConfig: {
        connection_method: "github-app-installation",
        installation_id: "98765",
        setup_action: "install",
      },
      credentialMaterials: [],
    });
  });

  it("fails fast when callback omits installation_id", async () => {
    await expect(async () =>
      GitHubAppInstallationRedirectHandler.complete({
        organizationId: "org_123",
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          secrets: {},
          config: {
            apiBaseUrl: "https://api.github.com/",
            webBaseUrl: "https://github.com/",
            appSlug: "mistle-app",
          },
        },
        query: new URLSearchParams(),
      }),
    ).rejects.toThrow("GitHub App installation callback is missing `installation_id`.");
  });
});
