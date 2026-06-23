import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
  SandboxPathRefs,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  GoogleSearchConsoleCredentialSecretTypes,
  GoogleSearchConsoleCredentialSlotKeys,
} from "./auth.js";
import { compileGoogleSearchConsoleBinding } from "./compile-binding.js";
import { GoogleSearchConsoleToolIds } from "./tool-ids.js";

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
      targetKey: "google-search-console-mcp",
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

describe("compileGoogleSearchConsoleBinding", () => {
  it("builds managed egress routes and the pinned Google Search Console CLI artifact", () => {
    const compiled = compileGoogleSearchConsoleBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-search-console-mcp",
      target: {
        familyId: "google-search-console",
        variantId: "google-search-console-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_search_console",
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
          tools: [GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_CLI],
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
          hosts: ["searchconsole.googleapis.com"],
        },
        upstream: {
          baseUrl: "https://searchconsole.googleapis.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_search_console",
          secretType: GoogleSearchConsoleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleSearchConsoleCredentialSlotKeys.accessToken,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("google-search-console-cli");
    expect(artifact?.name).toBe("Google Search Console CLI");
    expect(artifact?.env).toEqual({
      GSC_SEARCH_CONSOLE_BASE_URL: "https://searchconsole.googleapis.com",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Google Search Console CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "gsc/v0.1.0",
          },
          asset: {
            kind: "exact",
            fileName: "gsc-linux-amd64",
            format: "binary",
            sha256: "f98c3a993a23e05987d064c8e27004c28eb56e1e47cfbc93a689cd2a70e588f8",
          },
          installPath: "/usr/local/bin/gsc",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs the Google Search Console binary and starts a local MCP server when MCP is selected", () => {
    const compiled = compileGoogleSearchConsoleBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-search-console-mcp",
      target: {
        familyId: "google-search-console",
        variantId: "google-search-console-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_search_console",
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
          tools: [GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.artifactKey).toBe("google-search-console-cli");
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "google-search-console-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "google-search-console-mcp-server",
            command: {
              args: [
                "/usr/local/bin/gsc",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7349",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7349,
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

  it("omits the Google Search Console artifact and runtime client when no tools are selected", () => {
    const compiled = compileGoogleSearchConsoleBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-search-console-mcp",
      target: {
        familyId: "google-search-console",
        variantId: "google-search-console-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_search_console",
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

    expect(compiled.egressRoutes).toHaveLength(1);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
