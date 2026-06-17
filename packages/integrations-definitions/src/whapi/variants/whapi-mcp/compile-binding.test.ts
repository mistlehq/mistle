import type {
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { WhapiCredentialSlotKeys } from "./auth.js";
import { compileWhapiBinding, WhapiMcpWrapperPath } from "./compile-binding.js";
import { WhapiToolIds } from "./tool-ids.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths = {
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
          op: "exec",
          command: {
            args: ["mise", "install", ...input.tools],
          },
        };
      },
    },
    githubReleases: {
      install(): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: {
            args: ["github-releases.install"],
          },
        };
      },
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "whapi-mcp",
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

describe("compileWhapiBinding", () => {
  it("adds whapi mcp artifact, wrapper, and managed Whapi API route", () => {
    const compiled = compileWhapiBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "whapi-mcp",
      target: {
        familyId: "whapi",
        variantId: "whapi-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_whapi",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [WhapiToolIds.WHAPI_MCP],
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
          hosts: ["gate.whapi.cloud"],
        },
        upstream: {
          baseUrl: "https://gate.whapi.cloud",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_whapi",
          secretType: "api_key",
          slotKey: WhapiCredentialSlotKeys.API_TOKEN,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe(WhapiToolIds.WHAPI_MCP);
    expect(artifact?.name).toBe("Whapi MCP");
    if (artifact === undefined) {
      throw new Error("Expected compiled whapi mcp artifact.");
    }
    const installCommands = resolveArtifactLifecycleCommands(artifact).install;
    expect(installCommands).toHaveLength(2);
    expect(installCommands[0]).toEqual({
      op: "exec",
      command: {
        args: ["mise", "install", "node@24.11.1"],
      },
    });
    const installCommand = installCommands[1];
    if (installCommand?.op !== "exec") {
      throw new Error("Expected whapi mcp package install step to be an exec step.");
    }
    expect(installCommand.command.args).toEqual([
      "sh",
      "-euc",
      expect.stringContaining('package_spec="whapi-mcp@0.0.14"'),
    ]);
    expect(installCommand.command.args[2]).toContain(
      "mise exec node@24.11.1 -- npm install --omit=dev --ignore-scripts --no-audit --no-fund",
    );
    expect(installCommand.command.args[2]).toContain(
      "/var/lib/mistle/artifacts/whapi-mcp/node_modules/.bin/mcp-whapi",
    );

    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "whapi-mcp-runtime",
        setup: {
          env: {},
          files: [
            {
              fileId: "whapi_mcp_wrapper",
              path: WhapiMcpWrapperPath,
              mode: 0o755,
              content: [
                "#!/bin/sh",
                "set -eu",
                "",
                'export API_TOKEN="mistle-placeholder"',
                "",
                'exec "/var/lib/mistle/artifacts/whapi-mcp/node_modules/.bin/mcp-whapi" "$@"',
              ].join("\n"),
            },
          ],
        },
        processes: [],
        endpoints: [],
      },
    ]);
  });

  it("omits routes and runtime material when Whapi MCP is not selected", () => {
    const compiled = compileWhapiBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "whapi-mcp",
      target: {
        familyId: "whapi",
        variantId: "whapi-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_whapi",
        status: "active",
        config: {
          connection_method: "api-key",
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
