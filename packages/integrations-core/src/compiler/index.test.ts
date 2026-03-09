import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { IntegrationRegistry } from "../registry/index.js";
import type { IntegrationDefinition } from "../types/index.js";
import { compileRuntimePlan } from "./index.js";

const OpenAiTargetConfigSchema = z.object({
  apiBaseUrl: z.url(),
});

const EmptyTargetSecretsSchema = z.object({});

const OpenAiBindingConfigSchema = z.object({
  defaultModel: z.string().min(1),
});

function createOpenAiDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof OpenAiBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "agent",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: OpenAiBindingConfigSchema,
    supportedAuthSchemes: ["api-key"],
    mcpConfig: {
      clientId: "codex-cli",
      fileId: "codex_config",
      format: "toml",
      path: ["mcp_servers"],
    },
    compileBinding: (input) => ({
      egressRoutes: [
        {
          match: {
            hosts: ["api.openai.com"],
            methods: ["POST"],
            pathPrefixes: ["/v1"],
          },
          upstream: {
            baseUrl: "https://api.openai.com",
          },
          authInjection: {
            type: "bearer",
            target: "authorization",
          },
          credentialResolver: {
            connectionId: input.connection.id,
            secretType: "api_key",
          },
        },
      ],
      artifacts: [
        {
          artifactKey: "codex-cli",
          name: "Codex CLI",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.installLatestBinary({
                repository: "openai/codex",
                assets: {
                  x86_64: {
                    fileName: "codex-x86_64-unknown-linux-musl.tar.gz",
                    binaryPath: "codex-x86_64-unknown-linux-musl",
                  },
                  aarch64: {
                    fileName: "codex-aarch64-unknown-linux-musl.tar.gz",
                    binaryPath: "codex-aarch64-unknown-linux-musl",
                  },
                },
                installPath: input.refs.artifactBinPath("codex"),
                timeoutMs: 120_000,
              }),
              refs.command.exec({
                args: ["echo", `binding:${refs.compileContext.bindingId}`],
              }),
            ],
            remove: ({ refs }) => [
              refs.command.exec({
                args: ["rm", "-f", refs.artifactBinPath("codex")],
              }),
            ],
          },
        },
      ],
      runtimeClients: [
        {
          clientId: "codex-cli",
          setup: {
            env: {
              OPENAI_BASE_URL: input.refs.egressUrl,
              OPENAI_MODEL: input.binding.config.defaultModel,
            },
            files: [
              {
                fileId: "codex_config",
                path: "/workspace/.codex/config.toml",
                mode: 384,
                content: 'model = "gpt-5.3-codex"',
              },
            ],
          },
          processes: [
            {
              processKey: "codex-app-server",
              command: {
                args: [
                  input.refs.artifactBinPath("codex"),
                  "app-server",
                  "--listen",
                  "ws://127.0.0.1:4747",
                ],
              },
              readiness: {
                type: "tcp",
                host: "127.0.0.1",
                port: 4747,
                timeoutMs: 5_000,
              },
              stop: {
                signal: "sigterm",
                timeoutMs: 10_000,
                gracePeriodMs: 2_000,
              },
            },
          ],
          endpoints: [
            {
              endpointKey: "app-server",
              processKey: "codex-app-server",
              transport: {
                type: "ws",
                url: "ws://127.0.0.1:4747",
              },
              connectionMode: "dedicated",
            },
          ],
        },
      ],
      agentRuntimes: [
        {
          runtimeKey: "codex-app-server",
          clientId: "codex-cli",
          endpointKey: "app-server",
          capabilities: {
            conversation: {
              providerFamily: "codex",
            },
          },
        },
      ],
    }),
  };
}

function createJsonAgentDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof OpenAiBindingConfigSchema
> {
  return {
    familyId: "anthropic",
    variantId: "claude-code-default",
    kind: "agent",
    displayName: "Claude Code",
    logoKey: "anthropic",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: OpenAiBindingConfigSchema,
    supportedAuthSchemes: ["api-key"],
    mcpConfig: {
      clientId: "claude-code",
      fileId: "claude_config",
      format: "json",
      path: ["mcpServers"],
    },
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [
        {
          clientId: "claude-code",
          setup: {
            env: {},
            files: [
              {
                fileId: "claude_config",
                path: "/workspace/.claude/settings.json",
                mode: 384,
                content: `{
  "theme": "dark"
}
`,
              },
            ],
          },
          processes: [],
          endpoints: [],
        },
      ],
    }),
  };
}

function createLinearMcpDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof OpenAiBindingConfigSchema
> {
  return {
    familyId: "linear",
    variantId: "linear-default",
    kind: "connector",
    displayName: "Linear",
    logoKey: "linear",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: OpenAiBindingConfigSchema,
    supportedAuthSchemes: ["api-key"],
    mcp: (input) => ({
      serverId: "linear-default",
      serverName: "linear",
      transport: "streamable-http",
      url: input.refs.egressUrl,
    }),
    compileBinding: (input) => ({
      egressRoutes: [
        {
          match: {
            hosts: ["linear.app"],
            methods: ["POST"],
            pathPrefixes: ["/mcp"],
          },
          upstream: {
            baseUrl: "https://linear.app",
          },
          authInjection: {
            type: "bearer",
            target: "authorization",
          },
          credentialResolver: {
            connectionId: input.connection.id,
            secretType: "api_key",
          },
        },
      ],
      artifacts: [],
      runtimeClients: [],
    }),
  };
}

function createLinearDuplicateNameMcpDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof OpenAiBindingConfigSchema
> {
  return {
    familyId: "linear",
    variantId: "linear-duplicate-name",
    kind: "connector",
    displayName: "Linear Duplicate",
    logoKey: "linear",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: OpenAiBindingConfigSchema,
    supportedAuthSchemes: ["api-key"],
    mcp: {
      serverId: "linear-duplicate-name",
      serverName: "linear",
      transport: "streamable-http",
      url: "https://duplicate.example.com/mcp",
    },
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    }),
  };
}

function createGithubReleaseArtifactDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof OpenAiBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "agent",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: OpenAiBindingConfigSchema,
    supportedAuthSchemes: ["api-key"],
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "codex-cli",
          name: "Codex CLI",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.installLatestBinary({
                repository: "openai/codex",
                assets: {
                  x86_64: {
                    fileName: "codex-x86_64-unknown-linux-musl.tar.gz",
                    binaryPath: "codex-x86_64-unknown-linux-musl",
                  },
                  aarch64: {
                    fileName: "codex-aarch64-unknown-linux-musl.tar.gz",
                    binaryPath: "codex-aarch64-unknown-linux-musl",
                  },
                },
                installPath: "/workspace/.mistle/bin/codex",
                timeoutMs: 120_000,
              }),
            ],
            remove: ({ refs }) => [
              refs.command.exec({
                args: ["rm", "-f", "/workspace/.mistle/bin/codex"],
              }),
            ],
          },
        },
      ],
      runtimeClients: [],
    }),
  };
}

function createOpenAiNoArtifactDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof OpenAiBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-no-artifacts",
    kind: "agent",
    displayName: "OpenAI (No Artifacts)",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: OpenAiBindingConfigSchema,
    supportedAuthSchemes: ["api-key"],
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    }),
  };
}

describe("compileRuntimePlan", () => {
  it("compiles bindings into a deterministic runtime plan", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
      },
      registry,
      bindings: [
        {
          targetKey: "openai-default",
          target: {
            familyId: "openai",
            variantId: "openai-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.openai.com",
            },
            secrets: {},
          },
          connection: {
            id: "conn_openai_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_openai_agent",
            kind: "agent",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
      ],
    });

    expect(runtimePlan.sandboxProfileId).toBe("sbp_123");
    expect(runtimePlan.version).toBe(12);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.egressRoutes[0]).toMatchObject({
      routeId: "route_bind_openai_agent",
      bindingId: "bind_openai_agent",
    });
    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.artifacts[0]?.artifactKey).toBe("codex-cli");
    expect(runtimePlan.artifacts[0]?.name).toBe("Codex CLI");
    expect(runtimePlan.artifacts[0]?.lifecycle.install).toHaveLength(2);
    expect(runtimePlan.artifacts[0]?.lifecycle.install[0]?.args[0]).toBe("sh");
    expect(runtimePlan.artifacts[0]?.lifecycle.install[0]?.args[1]).toBe("-euc");
    expect(runtimePlan.artifacts[0]?.lifecycle.install[0]?.args[2]).toContain("openai/codex");
    expect(runtimePlan.artifacts[0]?.lifecycle.install[0]?.timeoutMs).toBe(120_000);
    expect(runtimePlan.artifacts[0]?.lifecycle.install[1]).toEqual({
      args: ["echo", "binding:bind_openai_agent"],
    });
    expect(runtimePlan.runtimeClients).toHaveLength(1);
    expect(runtimePlan.runtimeClients[0]?.setup.env.OPENAI_BASE_URL).toBe(
      "http://127.0.0.1:8090/egress/routes/route_bind_openai_agent",
    );
    expect(runtimePlan.runtimeClients[0]?.processes).toEqual([
      {
        processKey: "codex-app-server",
        command: {
          args: ["/workspace/.mistle/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4747"],
        },
        readiness: {
          type: "tcp",
          host: "127.0.0.1",
          port: 4747,
          timeoutMs: 5_000,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: 10_000,
          gracePeriodMs: 2_000,
        },
      },
    ]);
    expect(runtimePlan.agentRuntimes).toEqual([
      {
        bindingId: "bind_openai_agent",
        runtimeKey: "codex-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server",
        capabilities: {
          conversation: {
            providerFamily: "codex",
          },
        },
      },
    ]);
    expect(runtimePlan.artifactRemovals).toEqual([]);
  });

  it("supports github release binary install refs in artifact lifecycle hooks", () => {
    const registry = new IntegrationRegistry();
    registry.register(createGithubReleaseArtifactDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
      },
      registry,
      bindings: [
        {
          targetKey: "openai-default",
          target: {
            familyId: "openai",
            variantId: "openai-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.openai.com",
            },
            secrets: {},
          },
          connection: {
            id: "conn_openai_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_openai_agent",
            kind: "agent",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
      ],
    });

    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.artifacts[0]?.lifecycle.install).toHaveLength(1);
    expect(runtimePlan.artifacts[0]?.lifecycle.install[0]?.args[0]).toBe("sh");
    expect(runtimePlan.artifacts[0]?.lifecycle.install[0]?.args[1]).toBe("-euc");
    expect(runtimePlan.artifacts[0]?.lifecycle.install[0]?.timeoutMs).toBe(120_000);

    const installScript = runtimePlan.artifacts[0]?.lifecycle.install[0]?.args[2];
    expect(typeof installScript).toBe("string");
    expect(installScript).toContain(
      'curl -fsSL "https://github.com/$repo/releases/latest/download/$asset_name"',
    );
    expect(installScript).toContain("openai/codex");
    expect(installScript).toContain("codex-x86_64-unknown-linux-musl.tar.gz");
    expect(installScript).toContain("codex-aarch64-unknown-linux-musl.tar.gz");
    expect(installScript).toContain("/workspace/.mistle/bin/codex");
  });

  it("collects MCP servers from connectors and maps them into agent runtime files", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());
    registry.register(createLinearMcpDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
      },
      registry,
      bindings: [
        {
          targetKey: "openai-default",
          target: {
            familyId: "openai",
            variantId: "openai-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.openai.com",
            },
            secrets: {},
          },
          connection: {
            id: "conn_openai_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_openai_agent",
            kind: "agent",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
        {
          targetKey: "linear-default",
          target: {
            familyId: "linear",
            variantId: "linear-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://linear.app",
            },
            secrets: {},
          },
          connection: {
            id: "conn_linear_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_linear_connector",
            kind: "connector",
            connectionId: "conn_linear_org_123",
            config: {
              defaultModel: "unused",
            },
          },
        },
      ],
    });

    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      "[mcp_servers.linear]",
    );
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      'url = "http://127.0.0.1:8090/egress/routes/route_bind_linear_connector"',
    );
  });

  it("maps MCP servers into json agent config files using the configured path", () => {
    const registry = new IntegrationRegistry();
    registry.register(createJsonAgentDefinition());
    registry.register(createLinearMcpDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
      },
      registry,
      bindings: [
        {
          targetKey: "claude-code-default",
          target: {
            familyId: "anthropic",
            variantId: "claude-code-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.anthropic.com",
            },
            secrets: {},
          },
          connection: {
            id: "conn_claude_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_claude_agent",
            kind: "agent",
            connectionId: "conn_claude_org_123",
            config: {
              defaultModel: "claude-sonnet",
            },
          },
        },
        {
          targetKey: "linear-default",
          target: {
            familyId: "linear",
            variantId: "linear-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://linear.app",
            },
            secrets: {},
          },
          connection: {
            id: "conn_linear_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_linear_connector",
            kind: "connector",
            connectionId: "conn_linear_org_123",
            config: {
              defaultModel: "unused",
            },
          },
        },
      ],
    });

    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain('"theme": "dark"');
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain('"mcpServers"');
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain('"linear"');
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      '"url": "http://127.0.0.1:8090/egress/routes/route_bind_linear_connector"',
    );
  });

  it("fails when multiple bindings declare the same MCP server name", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());
    registry.register(createLinearMcpDefinition());
    registry.register(createLinearDuplicateNameMcpDefinition());

    expect(() =>
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 12,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "https://api.openai.com",
              },
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {
                defaultModel: "gpt-5.3-codex",
              },
            },
          },
          {
            targetKey: "linear-default",
            target: {
              familyId: "linear",
              variantId: "linear-default",
              enabled: true,
              config: {
                apiBaseUrl: "https://linear.app",
              },
              secrets: {},
            },
            connection: {
              id: "conn_linear_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_linear_connector",
              kind: "connector",
              connectionId: "conn_linear_org_123",
              config: {
                defaultModel: "unused",
              },
            },
          },
          {
            targetKey: "linear-duplicate-name",
            target: {
              familyId: "linear",
              variantId: "linear-duplicate-name",
              enabled: true,
              config: {
                apiBaseUrl: "https://duplicate.example.com",
              },
              secrets: {},
            },
            connection: {
              id: "conn_linear_duplicate_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_linear_connector_duplicate",
              kind: "connector",
              connectionId: "conn_linear_duplicate_org_123",
              config: {
                defaultModel: "unused",
              },
            },
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 12,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "https://api.openai.com",
              },
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {
                defaultModel: "gpt-5.3-codex",
              },
            },
          },
          {
            targetKey: "linear-default",
            target: {
              familyId: "linear",
              variantId: "linear-default",
              enabled: true,
              config: {
                apiBaseUrl: "https://linear.app",
              },
              secrets: {},
            },
            connection: {
              id: "conn_linear_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_linear_connector",
              kind: "connector",
              connectionId: "conn_linear_org_123",
              config: {
                defaultModel: "unused",
              },
            },
          },
          {
            targetKey: "linear-duplicate-name",
            target: {
              familyId: "linear",
              variantId: "linear-duplicate-name",
              enabled: true,
              config: {
                apiBaseUrl: "https://duplicate.example.com",
              },
              secrets: {},
            },
            connection: {
              id: "conn_linear_duplicate_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_linear_connector_duplicate",
              kind: "connector",
              connectionId: "conn_linear_duplicate_org_123",
              config: {
                defaultModel: "unused",
              },
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.MCP_CONFLICT);
      }
    }
  });

  it("fails when target is disabled", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    expect(() =>
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: false,
              config: {},
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {},
            },
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: false,
              config: {},
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {},
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.TARGET_DISABLED);
      }
    }
  });

  it("includes artifact removals for artifact keys present only in previous bindings", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());
    registry.register(createOpenAiNoArtifactDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 3,
      image: {
        source: "snapshot",
        imageRef: "127.0.0.1:5001/mistle/sandbox-snapshots@sha256:test",
        instanceId: "sbi_123",
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
      },
      registry,
      bindings: [
        {
          targetKey: "openai-no-artifacts",
          target: {
            familyId: "openai",
            variantId: "openai-no-artifacts",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.openai.com",
            },
            secrets: {},
          },
          connection: {
            id: "conn_openai_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_openai_agent_new",
            kind: "agent",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
      ],
      previousBindings: [
        {
          targetKey: "openai-default",
          target: {
            familyId: "openai",
            variantId: "openai-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.openai.com",
            },
            secrets: {},
          },
          connection: {
            id: "conn_openai_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_openai_agent_old",
            kind: "agent",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
      ],
    });

    expect(runtimePlan.artifacts).toEqual([]);
    expect(runtimePlan.artifactRemovals).toEqual([
      {
        artifactKey: "codex-cli",
        commands: [{ args: ["rm", "-f", "/workspace/.mistle/bin/codex"] }],
      },
    ]);
  });

  it("fails when resolved connection does not match binding connectionId", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    expect(() =>
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {},
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_999",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {},
            },
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {},
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_999",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {},
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.CONNECTION_MISMATCH);
      }
    }
  });

  it("fails when target config does not satisfy schema", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    expect(() =>
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "not-a-url",
              },
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {
                defaultModel: "gpt-5.3-codex",
              },
            },
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "not-a-url",
              },
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {
                defaultModel: "gpt-5.3-codex",
              },
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.INVALID_TARGET_CONFIG);
      }
    }
  });

  it("fails when target secrets do not satisfy schema", () => {
    const targetSecretSchema = z.object({
      webhookSecret: z.string().min(1),
    });

    const definition: IntegrationDefinition<
      typeof OpenAiTargetConfigSchema,
      typeof targetSecretSchema,
      typeof OpenAiBindingConfigSchema
    > = {
      familyId: "openai",
      variantId: "openai-default",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema: OpenAiTargetConfigSchema,
      targetSecretSchema,
      bindingConfigSchema: OpenAiBindingConfigSchema,
      supportedAuthSchemes: ["api-key"],
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    };

    const registry = new IntegrationRegistry();
    registry.register(definition);

    expect(() =>
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "https://api.openai.com",
              },
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {
                defaultModel: "gpt-5.3-codex",
              },
            },
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "https://api.openai.com",
              },
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {
                defaultModel: "gpt-5.3-codex",
              },
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.INVALID_TARGET_SECRETS);
      }
    }
  });

  it("fails when binding config does not satisfy schema", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    expect(() =>
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "https://api.openai.com",
              },
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {
                defaultModel: "",
              },
            },
          },
        ],
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        runtimeContext: {
          sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
        },
        registry,
        bindings: [
          {
            targetKey: "openai-default",
            target: {
              familyId: "openai",
              variantId: "openai-default",
              enabled: true,
              config: {
                apiBaseUrl: "https://api.openai.com",
              },
              secrets: {},
            },
            connection: {
              id: "conn_openai_org_123",
              status: "active",
              config: {},
            },
            binding: {
              id: "bind_openai_agent",
              kind: "agent",
              connectionId: "conn_openai_org_123",
              config: {
                defaultModel: "",
              },
            },
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.INVALID_BINDING_CONFIG);
      }
    }
  });

  it("passes parsed schema outputs into compileBinding", () => {
    const targetConfigSchema = z
      .object({
        apiBaseUrl: z.url(),
      })
      .transform((config) => ({
        apiHost: new URL(config.apiBaseUrl).host,
      }));
    const bindingConfigSchema = z
      .object({
        defaultModel: z.string().min(1),
      })
      .transform((config) => ({
        normalizedModel: config.defaultModel.trim().toLowerCase(),
      }));

    const definition: IntegrationDefinition<
      typeof targetConfigSchema,
      typeof EmptyTargetSecretsSchema,
      typeof bindingConfigSchema
    > = {
      familyId: "openai",
      variantId: "openai-default",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema,
      targetSecretSchema: EmptyTargetSecretsSchema,
      bindingConfigSchema,
      supportedAuthSchemes: ["api-key"],
      compileBinding: (input) => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [
          {
            clientId: "typed-config",
            setup: {
              env: {
                API_HOST: input.target.config.apiHost,
                MODEL: input.binding.config.normalizedModel,
                ROUTE_ID: input.refs.egressUrl.routeId,
              },
              files: [],
            },
            processes: [],
            endpoints: [],
          },
        ],
      }),
    };

    const registry = new IntegrationRegistry();
    registry.register(definition);

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      runtimeContext: {
        sandboxdEgressBaseUrl: "http://127.0.0.1:8090/egress",
      },
      registry,
      bindings: [
        {
          targetKey: "openai-default",
          target: {
            familyId: "openai",
            variantId: "openai-default",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.openai.com/v1",
            },
            secrets: {},
          },
          connection: {
            id: "conn_openai_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_openai_agent",
            kind: "agent",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: " GPT-5.3-CODEX ",
            },
          },
        },
      ],
    });

    expect(runtimePlan.runtimeClients).toEqual([
      {
        clientId: "typed-config",
        setup: {
          env: {
            API_HOST: "api.openai.com",
            MODEL: "gpt-5.3-codex",
            ROUTE_ID: "route_bind_openai_agent",
          },
          files: [],
        },
        processes: [],
        endpoints: [],
      },
    ]);
  });
});
