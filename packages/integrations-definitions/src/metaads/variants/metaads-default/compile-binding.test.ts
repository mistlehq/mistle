import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
  SandboxPathRefs,
} from "@mistle/integrations-core";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { MetaAdsCredentialSlotKeys } from "./auth.js";
import { compileMetaAdsBinding } from "./compile-binding.js";
import { MetaAdsToolIds } from "./tool-ids.js";

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
      targetKey: "metaads-default",
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

function compileWithTools(input: {
  tools: Array<(typeof MetaAdsToolIds)[keyof typeof MetaAdsToolIds]>;
  graphApiVersion?: string;
}) {
  return compileMetaAdsBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "metaads-default",
    target: {
      familyId: "metaads",
      variantId: "metaads-default",
      enabled: true,
      config: {
        graph_api_version: input.graphApiVersion ?? "v25.0",
      },
      secrets: {},
    },
    connection: {
      id: "icn_metaads",
      status: "active",
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    },
    binding: {
      id: "ibd_123",
      kind: "connector",
      config: {
        tools: input.tools,
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  });
}

describe("compileMetaAdsBinding", () => {
  it("builds the expected Meta Graph API egress route and pinned Meta Ads CLI artifact", () => {
    const compiled = compileWithTools({
      tools: [MetaAdsToolIds.METAADS_CLI],
      graphApiVersion: "v25.0",
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["graph.facebook.com"],
          pathPrefixes: ["/v25.0"],
        },
        upstream: {
          baseUrl: "https://graph.facebook.com/v25.0",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_metaads",
          secretType: "api_key",
          slotKey: MetaAdsCredentialSlotKeys.ACCESS_TOKEN,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("metaads-cli");
    expect(artifact?.name).toBe("Meta Ads CLI");
    expect(artifact?.env).toEqual({
      METAADS_GRAPH_BASE_URL: "https://graph.facebook.com/v25.0",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Meta Ads CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "metaads/v0.1.0",
          },
          asset: {
            kind: "exact",
            fileName: "metaads-linux-amd64",
            format: "binary",
            sha256: "969a6bc0c96f510cadb3a13f358f9347a6df0dbcad5c3bbd052c1758b3e278e3",
          },
          installPath: "/usr/local/bin/metaads",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs the Meta Ads binary and starts a local MCP server when Meta Ads MCP is selected", () => {
    const compiled = compileWithTools({ tools: [MetaAdsToolIds.METAADS_MCP] });

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.artifactKey).toBe("metaads-cli");
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "metaads-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "metaads-mcp-server",
            command: {
              args: [
                "/usr/local/bin/metaads",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7350",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7350,
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

  it("omits the Meta Ads artifact and runtime client when no tools are selected", () => {
    const compiled = compileWithTools({ tools: [] });

    expect(compiled.egressRoutes).toHaveLength(1);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
