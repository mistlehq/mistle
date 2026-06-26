import { describe, expect, it } from "vitest";

import { DiscordCredentialSlotKeys } from "./auth.js";
import { compileDiscordBinding, type DiscordCompileBindingInput } from "./compile-binding.js";

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
};

function createCompileBindingInput(tools: string[]): DiscordCompileBindingInput {
  return {
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "discord-default",
    target: {
      familyId: "discord",
      variantId: "discord-default",
      enabled: true,
      config: {
        apiBaseUrl: "https://discord.com/api/v10",
      },
      secrets: {},
    },
    connection: {
      id: "icn_discord",
      status: "active",
      config: {
        connection_method: "discord-bot",
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
      artifactBinPath: (name: string) => `/artifacts/${name}`,
    },
  };
}

describe("compileDiscordBinding", () => {
  it("builds Discord API egress with bot token authorization header injection", () => {
    const compiled = compileDiscordBinding(createCompileBindingInput([]));

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["discord.com"],
          pathPrefixes: ["/api/v10"],
        },
        upstream: {
          baseUrl: "https://discord.com/api/v10",
        },
        authInjection: {
          type: "header",
          target: "authorization",
          credentialPrefix: "Bot ",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_discord",
          secretType: "api_key",
          slotKey: DiscordCredentialSlotKeys.BOT_TOKEN,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("starts the local Discord MCP server when selected", () => {
    const compiled = compileDiscordBinding(createCompileBindingInput(["discord-mcp"]));

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "discord-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "discord-mcp-server",
            command: {
              args: [
                "/artifacts/discord",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7356",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7356,
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
