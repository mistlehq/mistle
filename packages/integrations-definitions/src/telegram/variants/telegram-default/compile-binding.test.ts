import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  TelegramBotTokenSlotKey,
  TelegramConnectionMethodId,
  TelegramCredentialSecretTypes,
} from "./auth.js";
import { compileTelegramBinding, type TelegramCompileBindingInput } from "./compile-binding.js";
import { TelegramCliToolId, TelegramMcpToolId } from "./tool-ids.js";

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

function createCompileBindingInput(tools: string[]): TelegramCompileBindingInput {
  return {
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "telegram-default",
    target: {
      familyId: "telegram",
      variantId: "telegram-default",
      enabled: true,
      config: {
        apiBaseUrl: "https://api.telegram.org",
      },
      secrets: {},
    },
    connection: {
      id: "icn_telegram",
      status: "active",
      config: {
        connection_method: TelegramConnectionMethodId,
      },
    },
    binding: {
      id: "ibd_123",
      kind: "connector",
      config: {
        tools,
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  };
}

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
      targetKey: "telegram-default",
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

describe("compileTelegramBinding", () => {
  it("builds Telegram API egress with bot-token path segment injection", () => {
    const compiled = compileTelegramBinding(createCompileBindingInput([]));

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.telegram.org"],
        },
        upstream: {
          baseUrl: "https://api.telegram.org",
        },
        authInjection: {
          type: "path_segment_prefix",
          segmentPrefix: "bot",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_telegram",
          secretType: TelegramCredentialSecretTypes.API_KEY,
          slotKey: TelegramBotTokenSlotKey,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs the pinned Telegram CLI release when the CLI tool is selected", () => {
    const compiled = compileTelegramBinding(createCompileBindingInput([TelegramCliToolId]));

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("telegram-cli");
    expect(artifact?.name).toBe("Telegram CLI");
    expect(artifact?.env).toEqual({
      TELEGRAM_BASE_URL: "https://api.telegram.org",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Telegram CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "telegram/v0.1.0",
          },
          asset: {
            kind: "exact",
            fileName: "telegram-linux-amd64",
            format: "binary",
            sha256: "8f5b6c62f7451ad02cf19d8fc4316f426b0816e9767dd22350e792c043680ea5",
          },
          installPath: "/usr/local/bin/telegram",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs the Telegram binary and starts a local MCP server when Telegram MCP is selected", () => {
    const compiled = compileTelegramBinding(createCompileBindingInput([TelegramMcpToolId]));

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.artifactKey).toBe("telegram-cli");
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "telegram-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "telegram-mcp-server",
            command: {
              args: [
                "/usr/local/bin/telegram",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7357",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7357,
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
});
