import type {
  CompileAgentRuntimeResult,
  EgressCredentialRoute,
  ResolvedIntegrationMcpServer,
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileCodexRuntime } from "./compile-runtime.js";

function createCompiledOpenAiRoute(input: {
  egressRuleId: string;
  host: string;
  baseUrl: string;
  secretType: string;
  additionalHeaders?: Record<string, string>;
}): EgressCredentialRoute {
  return {
    egressRuleId: input.egressRuleId,
    bindingId: "bind_openai_agent",
    familyId: "openai",
    variantId: "openai-default",
    match: {
      hosts: [input.host],
      methods: ["GET", "POST"],
      pathPrefixes: ["/"],
    },
    upstream: {
      baseUrl: input.baseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    ...(input.additionalHeaders === undefined
      ? {}
      : { additionalHeaders: input.additionalHeaders }),
    credentialResolver: {
      kind: "integration_connection",
      connectionId: "conn_openai_org_123",
      secretType: input.secretType,
    },
  };
}

function createMistleMcpServer(): ResolvedIntegrationMcpServer {
  return {
    source: {
      kind: "mistle",
    },
    server: {
      serverId: "mistle",
      serverName: "mistle",
      transport: "streamable-http",
      url: "https://mcp.example.test/mcp",
    },
  };
}

function renderRuntimeClients(input: {
  compiled: CompileAgentRuntimeResult;
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
}) {
  if (input.compiled.renderRuntimeClients === undefined) {
    throw new Error("Expected Codex runtime client renderer.");
  }

  return input.compiled.renderRuntimeClients({
    egressRoutes: input.egressRoutes,
  });
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
  it("compiles Codex runtime artifacts and renders app-server wiring from provider routes", () => {
    const compiled = compileCodexRuntime({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      runtimeId: "codex",
      runtimeConfig: {},
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
            tag: "rust-v0.136.0",
          },
          asset: {
            kind: "by_arch",
            x86_64: {
              fileName: "codex-x86_64-unknown-linux-musl.tar.gz",
              format: "tar.gz",
              extractedPath: "codex-x86_64-unknown-linux-musl",
              sha256: "dadad6c9db74500ad5431fa178b30288fdbdda6bdf3397634db6e1f5981321cf",
            },
            aarch64: {
              fileName: "codex-aarch64-unknown-linux-musl.tar.gz",
              format: "tar.gz",
              extractedPath: "codex-aarch64-unknown-linux-musl",
              sha256: "9dba0b8054541854b3cc3c12c25f52d6a441c90d87520e5260df56c09ba3eace",
            },
          },
          installPath: "/usr/local/bin/codex",
          timeoutMs: 120_000,
        },
      ],
    });
    const runtimeClients = renderRuntimeClients({
      compiled,
      egressRoutes: [
        createCompiledOpenAiRoute({
          egressRuleId: "egress_rule_bind_openai_agent",
          host: "api.openai.com",
          baseUrl: "https://api.openai.com",
          secretType: "api_key",
        }),
      ],
    });

    expect(runtimeClients).toHaveLength(1);
    expect(runtimeClients[0]).toMatchObject({
      clientId: "codex-cli",
      setup: {
        env: {},
        files: [
          {
            fileId: "codex_config",
            path: "/etc/codex/config.toml",
            mode: 384,
            writeMode: "if-absent",
          },
          {
            fileId: "codex_global_agents",
            path: "/root/.codex/AGENTS.md",
            mode: 384,
            writeMode: "if-absent",
          },
        ],
      },
    });
    expect(runtimeClients[0]?.processes).toEqual([
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
    expect(runtimeClients[0]?.endpoints).toEqual([
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
    const setupFiles = runtimeClients[0]?.setup.files;
    if (setupFiles === undefined) {
      throw new Error("Expected compiled Codex runtime setup files.");
    }
    const configFile = setupFiles.find((file) => file.fileId === "codex_config");
    if (configFile === undefined) {
      throw new Error("Expected compiled Codex config file.");
    }
    const agentsFile = setupFiles.find((file) => file.fileId === "codex_global_agents");
    if (agentsFile === undefined) {
      throw new Error("Expected compiled Codex global AGENTS.md file.");
    }

    expect(configFile.content).not.toContain("developer_instructions");
    expect(configFile.content).not.toContain("model =");
    expect(configFile.content).not.toContain("model_reasoning_effort");
    expect(configFile.content).toContain('model_provider = "proxy"');
    expect(configFile.content).toContain("[model_providers.proxy]");
    expect(configFile.content).toContain('base_url = "https://api.openai.com"');
    expect(configFile.content).toContain('wire_api = "responses"');
    expect(configFile.content).toContain("requires_openai_auth = false");
    expect(configFile.content).toContain("supports_websockets = true");
    expect(configFile.content).toContain("[features]");
    expect(configFile.content).toContain("apps = false");
    expect(configFile.content).toContain("goals = true");
    expect(configFile.content).toContain("plugins = false");
    expect(configFile.content).toContain("tool_search = true");
    expect(agentsFile.content).toContain("Mistle-managed sandbox context:");
    expect(agentsFile.content).toContain(
      "prefer the provider CLI available in the environment over ad hoc HTTP requests or raw `curl`",
    );
    expect(agentsFile.content).toContain(
      "Use `cmddir search <pattern>` to discover relevant commands progressively before reaching for lower-level approaches.",
    );
    expect(agentsFile.content).toContain(
      "`MISTLE_SANDBOX_INSTANCE_ID`, `MISTLE_SANDBOX_PROFILE_ID`, and `MISTLE_SANDBOX_PROFILE_VERSION` identify this sandbox",
    );
    expect(agentsFile.content).not.toContain("Mistle MCP tools are available");
    expect(agentsFile.content).not.toContain("User-provided additional instructions:");
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

  it("mentions Mistle MCP tools in managed instructions when Mistle MCP is configured", () => {
    const compiled = compileCodexRuntime({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      runtimeId: "codex",
      runtimeConfig: {},
      mcpServers: [createMistleMcpServer()],
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
    const runtimeClients = renderRuntimeClients({
      compiled,
      egressRoutes: [],
    });
    const agentsFile = runtimeClients[0]?.setup.files.find(
      (file) => file.fileId === "codex_global_agents",
    );
    if (agentsFile === undefined) {
      throw new Error("Expected compiled Codex global AGENTS.md file.");
    }

    expect(agentsFile.content).toContain(
      "Mistle MCP tools are available for interacting with Mistle resources",
    );
  });

  it("renders separate responses and ChatGPT backend bases for ChatGPT subscription mode", () => {
    const compiled = compileCodexRuntime({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      runtimeId: "codex",
      runtimeConfig: {},
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

    const runtimeClients = renderRuntimeClients({
      compiled,
      egressRoutes: [
        createCompiledOpenAiRoute({
          egressRuleId: "egress_rule_bind_openai_agent",
          host: "chatgpt.com",
          baseUrl: "https://chatgpt.com",
          secretType: "oauth2_access_token",
          additionalHeaders: {
            "ChatGPT-Account-ID": "acct_123",
          },
        }),
      ],
    });
    const configContent = runtimeClients[0]?.setup.files.find(
      (file) => file.fileId === "codex_config",
    )?.content;
    expect(configContent).toContain('model_provider = "proxy"');
    expect(configContent).toContain("[model_providers.proxy]");
    expect(configContent).toContain('base_url = "https://chatgpt.com/backend-api/codex"');
    expect(configContent).toContain('chatgpt_base_url = "https://chatgpt.com/backend-api"');
    expect(configContent).toContain("requires_openai_auth = false");
    expect(configContent).toContain("supports_websockets = true");
    expect(configContent).not.toContain("developer_instructions");
    expect(configContent).not.toContain("model =");
    expect(configContent).not.toContain("model_reasoning_effort");
    expect(configContent).toContain("[features]");
    expect(configContent).toContain("apps = false");
    expect(configContent).toContain("goals = true");
    expect(configContent).toContain("plugins = false");
    expect(configContent).toContain("tool_search = true");
  });

  it("omits Codex provider config when no proxied OpenAI route is present", () => {
    const runtimeClients = renderRuntimeClients({
      compiled: compileCodexRuntime({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        runtimeId: "codex",
        runtimeConfig: {},
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
      }),
      egressRoutes: [],
    });
    const configContent = runtimeClients[0]?.setup.files.find(
      (file) => file.fileId === "codex_config",
    )?.content;

    expect(configContent).not.toContain("model_provider");
    expect(configContent).not.toContain("model_providers");
    expect(configContent).not.toContain("base_url");
    expect(configContent).not.toContain("chatgpt_base_url");
    expect(configContent).toContain('approval_policy = "never"');
    expect(configContent).toContain('sandbox_mode = "danger-full-access"');
    expect(configContent).toContain("[features]");
    expect(configContent).toContain("apps = false");
    expect(configContent).toContain("goals = true");
    expect(configContent).toContain("plugins = false");
    expect(configContent).toContain("tool_search = true");
  });

  it("omits Codex provider config when proxied OpenAI routes are ambiguous", () => {
    const runtimeClients = renderRuntimeClients({
      compiled: compileCodexRuntime({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        runtimeId: "codex",
        runtimeConfig: {},
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
      }),
      egressRoutes: [
        createCompiledOpenAiRoute({
          egressRuleId: "egress_rule_bind_openai_agent",
          host: "api.openai.com",
          baseUrl: "https://api.openai.com",
          secretType: "api_key",
        }),
        createCompiledOpenAiRoute({
          egressRuleId: "egress_rule_bind_chatgpt",
          host: "chatgpt.com",
          baseUrl: "https://chatgpt.com",
          secretType: "oauth2_access_token",
        }),
      ],
    });
    const configContent = runtimeClients[0]?.setup.files.find(
      (file) => file.fileId === "codex_config",
    )?.content;

    expect(configContent).not.toContain("model_provider");
    expect(configContent).not.toContain("model_providers");
    expect(configContent).not.toContain("base_url");
    expect(configContent).not.toContain("chatgpt_base_url");
    expect(configContent).toContain('approval_policy = "never"');
    expect(configContent).toContain('sandbox_mode = "danger-full-access"');
  });
});
