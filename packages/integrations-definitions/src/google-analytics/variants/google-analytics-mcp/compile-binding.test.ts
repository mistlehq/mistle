import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
  SandboxPathRefs,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GoogleAnalyticsCredentialSecretTypes, GoogleAnalyticsCredentialSlotKeys } from "./auth.js";
import { compileGoogleAnalyticsBinding } from "./compile-binding.js";
import { GoogleAnalyticsToolIds } from "./tool-ids.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths: SandboxPathRefs = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
};

function resolveArtifactLifecycleCommands(artifact: RuntimeArtifactSpec): {
  install: ReadonlyArray<RuntimeArtifactInstallStep>;
} {
  const refs = {
    command: {
      exec(input: RuntimeExecCommand): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: input,
        };
      },
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install(input: {
        tools: ReadonlyArray<string>;
        force?: boolean;
        timeoutMs?: number;
      }): RuntimeArtifactInstallStep {
        return {
          op: "mise_install",
          tools: input.tools,
          ...(input.force === undefined ? {} : { force: input.force }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        };
      },
    },
    githubReleases: {
      install(input: RuntimeArtifactGitHubReleaseInstallHelperInput): RuntimeArtifactInstallStep {
        return {
          op: "github_release_install",
          ...input,
        };
      },
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-analytics-mcp",
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

describe("compileGoogleAnalyticsBinding", () => {
  it("builds managed egress routes and the pinned Google Analytics CLI artifact", () => {
    const compiled = compileGoogleAnalyticsBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-analytics-mcp",
      target: {
        familyId: "google-analytics",
        variantId: "google-analytics-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_analytics",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "google-client.apps.googleusercontent.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_CLI],
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
          hosts: ["analyticsadmin.googleapis.com"],
        },
        upstream: {
          baseUrl: "https://analyticsadmin.googleapis.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_analytics",
          secretType: GoogleAnalyticsCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleAnalyticsCredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["analyticsdata.googleapis.com"],
        },
        upstream: {
          baseUrl: "https://analyticsdata.googleapis.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_analytics",
          secretType: GoogleAnalyticsCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleAnalyticsCredentialSlotKeys.accessToken,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("google-analytics-cli");
    expect(artifact?.name).toBe("Google Analytics CLI");
    expect(artifact?.env).toEqual({
      GA_ANALYTICS_ADMIN_BASE_URL: "https://analyticsadmin.googleapis.com",
      GA_ANALYTICS_DATA_BASE_URL: "https://analyticsdata.googleapis.com",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Google Analytics CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "ga/v0.1.0",
          },
          asset: {
            kind: "exact",
            fileName: "ga-linux-amd64",
            format: "binary",
            sha256: "7509b10c10aba759d01c82bf86ceb25bac60954fc015d22ea076b428b73051a6",
          },
          installPath: "/usr/local/bin/ga",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs the Google Analytics binary and starts a local MCP server when MCP is selected", () => {
    const compiled = compileGoogleAnalyticsBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-analytics-mcp",
      target: {
        familyId: "google-analytics",
        variantId: "google-analytics-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_analytics",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "google-client.apps.googleusercontent.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.artifactKey).toBe("google-analytics-cli");
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "google-analytics-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "google-analytics-mcp-server",
            command: {
              args: [
                "/usr/local/bin/ga",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7347",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7347,
              timeoutMs: 60_000,
            },
            stop: {
              signal: "sigterm",
              timeoutMs: 10_000,
              gracePeriodMs: 2_000,
            },
          },
        ],
        endpoints: [],
      },
    ]);
  });

  it("omits the Google Analytics artifact and runtime client when no tools are selected", () => {
    const compiled = compileGoogleAnalyticsBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-analytics-mcp",
      target: {
        familyId: "google-analytics",
        variantId: "google-analytics-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_analytics",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "google-client.apps.googleusercontent.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toHaveLength(2);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
