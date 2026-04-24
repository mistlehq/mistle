import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileCodexRuntime } from "./compile-runtime.js";

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
    sandboxPaths: {
      userHomeDir: "/root",
      workspaceDir: "/root",
      runtimeDataDir: "/var/lib/mistle",
      runtimeArtifactDir: "/var/lib/mistle/artifacts",
      runtimeArtifactBinDir: "/usr/local/bin",
    },
    artifactBinPath: (artifactName: string) => `/usr/local/bin/${artifactName}`,
    mise: {
      install(input: {
        tools: ReadonlyArray<string>;
        force?: boolean;
        timeoutMs?: number;
      }): RuntimeArtifactInstallStep {
        return {
          op: "mise_install",
          tools: [...input.tools],
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
      targetKey: "openai-default",
      bindingId: "bind_openai_agent",
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

describe("compileCodexRuntime", () => {
  it("compiles Codex runtime artifacts and app-server wiring from provider access", () => {
    const compiled = compileCodexRuntime({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      bindingId: "bind_openai_agent",
      connectionId: "conn_openai_org_123",
      runtimeId: "codex",
      runtimeConfig: {},
      providerAccess: {
        providerFamilyId: "openai",
        providerVariantId: "openai-default",
        apiBaseUrl: "https://api.openai.com",
        authScheme: "bearer",
        credentialResolver: {
          connectionId: "conn_openai_org_123",
          secretType: "api_key",
        },
        additionalHeaders: {
          "ChatGPT-Account-ID": "acct_123",
        },
        allowedMethods: ["GET", "POST"],
        allowedPathPrefixes: ["/"],
        defaultModel: "gpt-5.3-codex",
        allowedModels: ["gpt-5.3-codex"],
        providerMetadata: {
          reasoningEffort: "medium",
          responsesApiBaseUrl: "https://api.openai.com",
          additionalInstructions: "Prefer concise answers.",
        },
      },
      mcpServers: [],
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (artifactName) => `/usr/local/bin/${artifactName}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.openai.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        additionalHeaders: {
          "ChatGPT-Account-ID": "acct_123",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "conn_openai_org_123",
          secretType: "api_key",
        },
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts?.[0]?.artifactKey).toBe("codex-cli");
    if (compiled.artifacts?.[0] === undefined) {
      throw new Error("Expected compiled Codex artifact.");
    }
    expect(resolveArtifactLifecycleCommands(compiled.artifacts[0])).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "openai/codex",
          release: {
            kind: "tag",
            match: "exact",
            tag: "rust-v0.124.0",
          },
          asset: {
            kind: "by_arch",
            x86_64: {
              fileName: "codex-x86_64-unknown-linux-musl.tar.gz",
              format: "tar.gz",
              extractedPath: "codex-x86_64-unknown-linux-musl",
            },
            aarch64: {
              fileName: "codex-aarch64-unknown-linux-musl.tar.gz",
              format: "tar.gz",
              extractedPath: "codex-aarch64-unknown-linux-musl",
            },
          },
          installPath: "/usr/local/bin/codex",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toHaveLength(1);
    expect(compiled.runtimeClients[0]).toMatchObject({
      clientId: "codex-cli",
      setup: {
        env: {
          OPENAI_MODEL: "gpt-5.3-codex",
          OPENAI_REASONING_EFFORT: "medium",
        },
        files: [
          {
            fileId: "codex_config",
            path: "/etc/codex/config.toml",
            mode: 384,
            writeMode: "if-absent",
          },
        ],
      },
    });
    expect(compiled.runtimeClients[0]?.processes).toEqual([
      {
        processKey: "codex-app-server",
        command: {
          args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4501"],
        },
        readiness: {
          type: "ws",
          url: "ws://127.0.0.1:4501",
          timeoutMs: 60_000,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: 10_000,
          gracePeriodMs: 2_000,
        },
      },
    ]);
    expect(compiled.runtimeClients[0]?.endpoints).toEqual([
      {
        endpointKey: "app-server",
        processKey: "codex-app-server",
        transport: {
          type: "ws",
          url: "ws://127.0.0.1:4500",
        },
        connectionMode: "dedicated",
      },
    ]);
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain(
      'developer_instructions = "Mistle-managed sandbox context:',
    );
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain(
      "prefer the provider CLI available in the environment over ad hoc HTTP requests or raw `curl`",
    );
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain(
      "Use `cmddir search <pattern>` to discover relevant commands progressively before reaching for lower-level approaches.",
    );
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain(
      "Prefer concise answers.",
    );
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain("[features]");
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain("apps = false");
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain("plugins = false");
    expect(compiled.runtimeClients[0]?.setup.files[0]?.content).toContain("tool_search = true");
    expect(compiled.agentRuntimes).toEqual([
      {
        runtimeId: "codex",
        runtimeKey: "codex-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server",
        ptyLaunch: {
          runtimeId: "codex",
          displayName: "Codex",
          newLaunch: {
            ptySessionId: "cli",
            cols: 120,
            rows: 32,
            command: "codex",
            args: [
              {
                kind: "literal",
                value: "--remote",
              },
              {
                kind: "literal",
                value: "ws://127.0.0.1:4500",
              },
            ],
          },
          resumeLaunch: {
            ptySessionId: "cli",
            cols: 120,
            rows: 32,
            command: "codex",
            args: [
              {
                kind: "literal",
                value: "resume",
              },
              {
                kind: "literal",
                value: "--remote",
              },
              {
                kind: "literal",
                value: "ws://127.0.0.1:4500",
              },
              {
                kind: "threadId",
              },
            ],
          },
        },
      },
    ]);
  });

  it("renders separate responses and ChatGPT backend bases for ChatGPT subscription mode", () => {
    const compiled = compileCodexRuntime({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      bindingId: "bind_openai_agent",
      connectionId: "conn_openai_org_123",
      runtimeId: "codex",
      runtimeConfig: {},
      providerAccess: {
        providerFamilyId: "openai",
        providerVariantId: "openai-default",
        apiBaseUrl: "https://chatgpt.com",
        authScheme: "bearer",
        credentialResolver: {
          connectionId: "conn_openai_org_123",
          secretType: "chatgpt_access_token",
        },
        additionalHeaders: {
          "ChatGPT-Account-ID": "acct_123",
        },
        allowedMethods: ["GET", "POST"],
        allowedPathPrefixes: ["/"],
        defaultModel: "gpt-5.4",
        allowedModels: ["gpt-5.4"],
        providerMetadata: {
          reasoningEffort: "medium",
          responsesApiBaseUrl: "https://chatgpt.com/backend-api/codex",
          chatgptBaseUrl: "https://chatgpt.com/backend-api",
        },
      },
      mcpServers: [],
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (artifactName) => `/usr/local/bin/${artifactName}`,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["chatgpt.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://chatgpt.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        additionalHeaders: {
          "ChatGPT-Account-ID": "acct_123",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "conn_openai_org_123",
          secretType: "chatgpt_access_token",
        },
      },
    ]);

    const configContent = compiled.runtimeClients[0]?.setup.files[0]?.content;
    expect(configContent).toContain('name = "OpenAI"');
    expect(configContent).toContain('base_url = "https://chatgpt.com/backend-api/codex"');
    expect(configContent).toContain('chatgpt_base_url = "https://chatgpt.com/backend-api"');
    expect(configContent).toContain("[features]");
    expect(configContent).toContain("apps = false");
    expect(configContent).toContain("plugins = false");
    expect(configContent).toContain("tool_search = true");
  });
});
