import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { XeroCredentialSlotKeys, XeroOAuthScopes } from "./auth.js";
import { XeroMcpBaseDefinition } from "./base-definition.js";
import { compileXeroBinding } from "./compile-binding.js";
import { XeroToolIds } from "./tool-ids.js";

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
          op: "exec",
          command: {
            args: ["mise", "install", ...input.tools],
          },
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
      targetKey: "xero-mcp",
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

describe("compileXeroBinding", () => {
  it("adds Xero CLI artifact, local MCP runtime, and managed Xero API route", () => {
    const compiled = compileXeroBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "xero-mcp",
      target: {
        familyId: "xero",
        variantId: "xero-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_xero",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "xero_client_123",
          scopes: [...XeroOAuthScopes],
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [XeroToolIds.XERO_MCP],
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
          hosts: ["api.xero.com"],
        },
        upstream: {
          baseUrl: "https://api.xero.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_xero",
          secretType: "oauth2_access_token",
          slotKey: XeroCredentialSlotKeys.accessToken,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("xero-cli");
    expect(artifact?.name).toBe("Xero CLI");
    expect(artifact?.env).toEqual({
      XERO_API_BASE_URL: "https://api.xero.com",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Xero CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "xero/v0.1.0",
          },
          asset: {
            kind: "exact",
            fileName: "xero-linux-amd64",
            format: "binary",
            sha256: "780a67e8f2d867349916fb2f1ee36e362a9c0d9553d7650c68c87c522dc8f9b7",
          },
          installPath: "/usr/local/bin/xero",
          timeoutMs: 120_000,
        },
      ],
    });

    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "xero-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "xero-mcp-server",
            command: {
              args: [
                "/usr/local/bin/xero",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7355",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7355,
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

  it("exposes the selected Xero server as streamable HTTP", () => {
    const resolveMcp = XeroMcpBaseDefinition.mcp;
    if (typeof resolveMcp !== "function") {
      throw new Error("Expected Xero MCP definition to resolve from binding input.");
    }

    expect(
      resolveMcp({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "xero-mcp",
        target: {
          familyId: "xero",
          variantId: "xero-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_xero",
          status: "active",
          config: {
            connection_method: "oauth2-authorization-code",
            client_id: "xero_client_123",
            scopes: [...XeroOAuthScopes],
          },
        },
        binding: {
          id: "ibd_123",
          kind: "connector",
          config: {
            tools: [XeroToolIds.XERO_MCP],
          },
        },
        refs: {
          sandboxPaths: SandboxPaths,
          artifactBinPath,
        },
      }),
    ).toEqual([
      {
        serverId: "xero-mcp",
        serverName: "xero",
        transport: "streamable-http",
        url: "http://127.0.0.1:7355/mcp",
        description: "Xero MCP tools backed by direct Xero API calls.",
      },
    ]);
  });

  it("omits routes and runtime material when Xero MCP is not selected", () => {
    const compiled = compileXeroBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "xero-mcp",
      target: {
        familyId: "xero",
        variantId: "xero-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_xero",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "xero_client_123",
          scopes: [...XeroOAuthScopes],
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

    expect(compiled.egressRoutes).toEqual([]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
