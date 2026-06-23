import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
  SandboxPathRefs,
} from "@mistle/integrations-core";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GoogleAdsCredentialSlotKeys } from "./auth.js";
import { compileGoogleAdsBinding } from "./compile-binding.js";
import { GoogleAdsToolIds } from "./tool-ids.js";

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
      targetKey: "googleads-default",
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
  tools: Array<(typeof GoogleAdsToolIds)[keyof typeof GoogleAdsToolIds]>;
  apiVersion?: string;
}) {
  return compileGoogleAdsBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "googleads-default",
    target: {
      familyId: "googleads",
      variantId: "googleads-default",
      enabled: true,
      config: {
        api_version: input.apiVersion ?? "v24",
      },
      secrets: {},
    },
    connection: {
      id: "icn_googleads",
      status: "active",
      config: {
        connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        client_id: "google_client_123.apps.googleusercontent.com",
        developer_token: "developer_token_123",
        login_customer_id: "9876543210",
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

describe("compileGoogleAdsBinding", () => {
  it("builds the expected Google Ads API egress route and pinned Google Ads CLI artifact", () => {
    const compiled = compileWithTools({
      tools: [GoogleAdsToolIds.GOOGLEADS_CLI],
      apiVersion: "v24",
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["googleads.googleapis.com"],
          pathPrefixes: ["/v24"],
        },
        upstream: {
          baseUrl: "https://googleads.googleapis.com/v24",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_googleads",
          secretType: "oauth2_access_token",
          slotKey: GoogleAdsCredentialSlotKeys.accessToken,
        },
        additionalHeaders: {
          "developer-token": "developer_token_123",
          "login-customer-id": "9876543210",
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("googleads-cli");
    expect(artifact?.name).toBe("Google Ads CLI");
    expect(artifact?.env).toEqual({
      GOOGLEADS_BASE_URL: "https://googleads.googleapis.com/v24",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Google Ads CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "googleads/v0.1.0",
          },
          asset: {
            kind: "exact",
            fileName: "googleads-linux-amd64",
            format: "binary",
            sha256: "f67e15741e90bf450e3ded017cad74c6a3bad403f45ae3dfb6f24f0d7580b02a",
          },
          installPath: "/usr/local/bin/googleads",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs the Google Ads binary and starts a local MCP server when Google Ads MCP is selected", () => {
    const compiled = compileWithTools({ tools: [GoogleAdsToolIds.GOOGLEADS_MCP] });

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.artifactKey).toBe("googleads-cli");
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "googleads-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "googleads-mcp-server",
            command: {
              args: [
                "/usr/local/bin/googleads",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7352",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7352,
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

  it("omits the Google Ads artifact and runtime client when no tools are selected", () => {
    const compiled = compileWithTools({ tools: [] });

    expect(compiled.egressRoutes).toHaveLength(1);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
