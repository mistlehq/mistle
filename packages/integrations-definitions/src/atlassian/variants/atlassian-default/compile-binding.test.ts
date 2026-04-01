import type { RuntimeArtifactCommand, RuntimeArtifactSpec } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { AtlassianConnectionMethodIds } from "./auth.js";
import { compileAtlassianBinding } from "./compile-binding.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

function resolveArtifactLifecycleCommands(artifact: RuntimeArtifactSpec): {
  install: ReadonlyArray<RuntimeArtifactCommand>;
} {
  const refs = {
    command: {
      exec(input: RuntimeArtifactCommand): RuntimeArtifactCommand {
        return input;
      },
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install(input: { tools: ReadonlyArray<string>; force?: boolean; timeoutMs?: number }) {
        return {
          args: ["mise", "install", ...input.tools],
        };
      },
    },
    githubReleases: {
      installLatestBinary() {
        return {
          args: ["github-releases.installLatestBinary"],
        };
      },
      installLatestTaggedAsset() {
        return {
          args: ["github-releases.installLatestTaggedAsset"],
        };
      },
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "atlassian-default",
      bindingId: "ibd_123",
    },
  };

  const install =
    typeof artifact.lifecycle.install === "function"
      ? artifact.lifecycle.install({ refs })
      : artifact.lifecycle.install;
  return {
    install,
  };
}

describe("compileAtlassianBinding", () => {
  it("builds the expected Atlassian personal token egress route and optional jira artifact", () => {
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
        config: {
          tools: ["jira-cli"],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
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
    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("jira-cli");
    expect(artifact?.name).toBe("Jira CLI");
    expect(artifact?.env).toEqual({
      JIRA_BASE_URL: "https://mistle.atlassian.net",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled jira artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          args: ["github-releases.installLatestTaggedAsset"],
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the expected Atlassian service account token egress route and jira artifact env", () => {
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
        config: {
          tools: ["jira-cli"],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
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
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.env).toEqual({
      JIRA_BASE_URL: "https://api.atlassian.com/ex/jira/cloud-id-123",
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the expected Atlassian service account oauth client credentials egress route and jira artifact env", () => {
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
        config: {
          tools: ["jira-cli"],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
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
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.env).toEqual({
      JIRA_BASE_URL: "https://api.atlassian.com/ex/jira/cloud-id-123",
    });
    expect(compiled.runtimeClients).toEqual([]);
  });
});
