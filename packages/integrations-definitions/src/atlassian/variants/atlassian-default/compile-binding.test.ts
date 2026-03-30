import { describe, expect, it } from "vitest";

import { AtlassianConnectionMethodIds } from "./auth.js";
import { compileAtlassianBinding } from "./compile-binding.js";

describe("compileAtlassianBinding", () => {
  it("builds the expected Atlassian personal token egress route", () => {
    const compiled = compileAtlassianBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "atlassian-default",
      target: {
        familyId: "atlassian",
        variantId: "atlassian-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_personal",
        status: "active",
        config: {
          connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
          site_url: "https://mistle.atlassian.net",
          email: "user@example.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {},
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (name) => `/usr/local/bin/${name}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mistle.atlassian.net"],
        },
        upstream: {
          baseUrl: "https://mistle.atlassian.net",
        },
        authInjection: {
          type: "basic",
          target: "authorization",
          username: "user@example.com",
        },
        credentialResolver: {
          connectionId: "icn_personal",
          secretType: "api_key",
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the expected Atlassian service account token egress route", () => {
    const compiled = compileAtlassianBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "atlassian-default",
      target: {
        familyId: "atlassian",
        variantId: "atlassian-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_service_account",
        status: "active",
        config: {
          connection_method: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          cloud_id: "cloud-id-123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {},
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (name) => `/usr/local/bin/${name}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.atlassian.com"],
          pathPrefixes: ["/ex/jira/cloud-id-123"],
        },
        upstream: {
          baseUrl: "https://api.atlassian.com/ex/jira/cloud-id-123",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_service_account",
          secretType: "api_key",
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the expected Atlassian service account oauth client credentials egress route", () => {
    const compiled = compileAtlassianBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "atlassian-default",
      target: {
        familyId: "atlassian",
        variantId: "atlassian-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_service_account_oauth",
        status: "active",
        config: {
          connection_method: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
          cloud_id: "cloud-id-123",
          client_id: "client-id-456",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {},
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (name) => `/usr/local/bin/${name}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.atlassian.com"],
          pathPrefixes: ["/ex/jira/cloud-id-123"],
        },
        upstream: {
          baseUrl: "https://api.atlassian.com/ex/jira/cloud-id-123",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_service_account_oauth",
          secretType: "oauth2_access_token",
          purpose: "oauth2_access_token",
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
