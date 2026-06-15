import type {
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { ResendCredentialSlotKeys } from "./auth.js";
import { compileResendBinding, ResendMcpWrapperPath } from "./compile-binding.js";
import { ResendToolIds } from "./tool-ids.js";

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
      targetKey: "resend-mcp",
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

describe("compileResendBinding", () => {
  it("adds resend mcp artifact, wrapper, and managed Resend API route", () => {
    const compiled = compileResendBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "resend-mcp",
      target: {
        familyId: "resend",
        variantId: "resend-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_resend",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [ResendToolIds.RESEND_MCP],
          senderEmailAddress: "onboarding@example.com",
          replyToEmailAddresses: ["support@example.com", "sales@example.com"],
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
          hosts: ["api.resend.com"],
        },
        upstream: {
          baseUrl: "https://api.resend.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_resend",
          secretType: "api_key",
          slotKey: ResendCredentialSlotKeys.API_KEY,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe(ResendToolIds.RESEND_MCP);
    expect(artifact?.name).toBe("Resend MCP");
    if (artifact === undefined) {
      throw new Error("Expected compiled resend mcp artifact.");
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
      throw new Error("Expected resend mcp package install step to be an exec step.");
    }
    expect(installCommand.command.args).toEqual([
      "sh",
      "-euc",
      expect.stringContaining('package_spec="resend-mcp@2.6.1"'),
    ]);
    expect(installCommand.command.args[2]).toContain(
      "mise exec node@24.11.1 -- npm install --omit=dev --ignore-scripts --no-audit --no-fund",
    );
    expect(installCommand.command.args[2]).toContain(
      "/var/lib/mistle/artifacts/resend-mcp/node_modules/.bin/resend-mcp",
    );

    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "resend-mcp-runtime",
        setup: {
          env: {},
          files: [
            {
              fileId: "resend_mcp_wrapper",
              path: ResendMcpWrapperPath,
              mode: 0o755,
              content: [
                "#!/bin/sh",
                "set -eu",
                "",
                'export RESEND_API_KEY="mistle-placeholder"',
                'export SENDER_EMAIL_ADDRESS="onboarding@example.com"',
                'export REPLY_TO_EMAIL_ADDRESSES="support@example.com,sales@example.com"',
                "",
                'exec "/var/lib/mistle/artifacts/resend-mcp/node_modules/.bin/resend-mcp" "$@"',
              ].join("\n"),
            },
          ],
        },
        processes: [],
        endpoints: [],
      },
    ]);
  });

  it("omits routes and runtime material when Resend MCP is not selected", () => {
    const compiled = compileResendBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "resend-mcp",
      target: {
        familyId: "resend",
        variantId: "resend-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_resend",
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
          replyToEmailAddresses: [],
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
