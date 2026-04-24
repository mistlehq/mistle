import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AgentRuntimeRegistry } from "../agent-runtimes/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { IntegrationRegistry } from "../registry/index.js";
import {
  type CompileBindingResult,
  IntegrationConnectionMethodIds,
  IntegrationMcpConfigFormats,
  type IntegrationDefinition,
  type RuntimeArtifactInstallStep,
} from "../types/index.js";
import { compileRuntimePlan } from "./index.js";

const OpenAiTargetConfigSchema = z.object({
  apiBaseUrl: z.url(),
});

const EmptyTargetSecretsSchema = z.object({});

const AgentBindingConfigSchema = z.object({
  runtime: z.object({
    runtimeId: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
  }),
  model: z.object({
    defaultModel: z.string().min(1),
    options: z.record(z.string(), z.unknown()),
  }),
});

const ConnectorBindingConfigSchema = z.object({
  defaultModel: z.string().min(1),
});

const LinearConnectorBindingConfigSchema = z.object({
  tools: z.array(z.literal("linear-mcp")).default([]),
});

const ApiKeyConnectionMethods = [
  {
    id: IntegrationConnectionMethodIds.API_KEY,
    label: "API key",
    kind: "form",
    secretFields: [
      {
        name: "apiKey",
        label: "API key",
        inputType: "password",
        secretType: "api_key",
        slotKey: "test.openai.api-key.api-key",
      },
    ],
  },
] as const;

const NoopConversationProvider = {
  connect: async () => ({
    request: async () => ({ ok: true }),
    close: async () => {},
  }),
  inspectConversation: async () => ({
    exists: true,
    status: "idle" as const,
    activeExecutionId: null,
  }),
  createConversation: async () => ({
    providerConversationId: "thread_123",
  }),
  resumeConversation: async () => {},
  startExecution: async () => ({
    providerExecutionId: null,
  }),
  steerExecution: async () => ({
    providerExecutionId: "turn_123",
  }),
  interruptExecution: async () => {},
};

function expectTypedInstallStep(
  entry: RuntimeArtifactInstallStep | undefined,
): RuntimeArtifactInstallStep {
  if (entry === undefined) {
    throw new Error("Expected artifact install step.");
  }

  return entry;
}

function createDefinitionsBundle(registry: IntegrationRegistry) {
  const agentRuntimeRegistry = new AgentRuntimeRegistry();
  agentRuntimeRegistry.register({
    runtimeId: "codex",
    displayName: "Codex",
    configSchema: z.object({}).strict(),
    createConversationProvider: () => NoopConversationProvider,
    materializeMcpConfig: () => [
      {
        clientId: "codex-cli",
        fileId: "codex_config",
        format: IntegrationMcpConfigFormats.TOML,
        path: ["mcp_servers"],
      },
    ],
    compileRuntime: (input) => ({
      egressRoutes: [
        {
          match: {
            hosts: ["api.openai.com"],
            methods: ["POST"],
            pathPrefixes: ["/v1"],
          },
          upstream: {
            baseUrl: input.providerAccess.apiBaseUrl,
          },
          authInjection: {
            type: "bearer",
            target: "authorization",
          },
          credentialResolver: {
            kind: "integration_connection",
            connectionId: input.providerAccess.credentialResolver.connectionId,
            secretType: input.providerAccess.credentialResolver.secretType,
          },
        },
      ],
      artifacts: [
        {
          artifactKey: "codex-cli",
          name: "Codex CLI",
          env: {
            GH_TOKEN: "dummy-token",
          },
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.install({
                repository: "openai/codex",
                release: {
                  kind: "latest",
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
                installPath: refs.artifactBinPath("codex"),
                timeoutMs: 120_000,
              }),
              refs.command.exec({
                args: ["echo", `binding:${refs.compileContext.bindingId}`],
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
              OPENAI_BASE_URL: input.providerAccess.apiBaseUrl,
              OPENAI_MODEL: input.providerAccess.defaultModel,
            },
            files: [
              {
                fileId: "codex_config",
                path: "/root/.codex/config.toml",
                mode: 384,
                content: 'model = "gpt-5.3-codex"',
                writeMode: "if-absent",
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
              args: [],
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
                  kind: "threadId",
                },
              ],
            },
          },
        },
      ],
    }),
  });
  agentRuntimeRegistry.register({
    runtimeId: "claude-code",
    displayName: "Claude Code",
    configSchema: z.object({}).strict(),
    createConversationProvider: () => NoopConversationProvider,
    materializeMcpConfig: () => [
      {
        clientId: "claude-code",
        fileId: "claude_config",
        format: IntegrationMcpConfigFormats.JSON,
        path: ["mcpServers"],
      },
    ],
    compileRuntime: () => ({
      runtimeClients: [
        {
          clientId: "claude-code",
          setup: {
            env: {},
            files: [
              {
                fileId: "claude_config",
                path: "/root/.claude/settings.json",
                mode: 384,
                content: `{
  "theme": "dark"
}
`,
              },
            ],
          },
          processes: [],
          endpoints: [
            {
              endpointKey: "claude-code",
              transport: {
                type: "ws",
                url: "ws://127.0.0.1:9001",
              },
              connectionMode: "dedicated",
            },
          ],
        },
      ],
      agentRuntimes: [
        {
          runtimeId: "claude-code",
          runtimeKey: "claude-code",
          clientId: "claude-code",
          endpointKey: "claude-code",
          ptyLaunch: {
            runtimeId: "claude-code",
            displayName: "Claude Code",
            newLaunch: {
              ptySessionId: "cli",
              cols: 120,
              rows: 32,
              command: "claude",
              args: [],
            },
            resumeLaunch: {
              ptySessionId: "cli",
              cols: 120,
              rows: 32,
              command: "claude",
              args: [
                {
                  kind: "literal",
                  value: "resume",
                },
                {
                  kind: "threadId",
                },
              ],
            },
          },
        },
      ],
    }),
  });

  return {
    integrationRegistry: registry,
    agentRuntimeRegistry,
  };
}

function createOpenAiDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof AgentBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "agent",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: AgentBindingConfigSchema,
    allowedRuntimeIds: ["codex"],
    connectionMethods: ApiKeyConnectionMethods,
    capabilities: {
      resolveCapabilities: (input) => ({
        agentProviderAccess: {
          providerFamilyId: input.target.familyId,
          providerVariantId: input.target.variantId,
          apiBaseUrl: input.target.config.apiBaseUrl,
          authScheme: "bearer",
          credentialResolver: {
            connectionId: input.connection.id,
            secretType: "api_key",
          },
          allowedMethods: ["POST"],
          allowedPathPrefixes: ["/v1"],
          defaultModel: input.binding.config.model.defaultModel,
          allowedModels: [input.binding.config.model.defaultModel],
        },
      }),
    },
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    }),
  };
}

function createJsonAgentDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof AgentBindingConfigSchema
> {
  return {
    familyId: "anthropic",
    variantId: "claude-code-default",
    kind: "agent",
    displayName: "Claude Code",
    logoKey: "anthropic",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: AgentBindingConfigSchema,
    allowedRuntimeIds: ["claude-code"],
    connectionMethods: ApiKeyConnectionMethods,
    capabilities: {
      resolveCapabilities: (input) => ({
        agentProviderAccess: {
          providerFamilyId: input.target.familyId,
          providerVariantId: input.target.variantId,
          apiBaseUrl: input.target.config.apiBaseUrl,
          authScheme: "bearer",
          credentialResolver: {
            connectionId: input.connection.id,
            secretType: "api_key",
          },
          allowedMethods: ["POST"],
          allowedPathPrefixes: ["/v1/messages"],
          defaultModel: input.binding.config.model.defaultModel,
          allowedModels: [input.binding.config.model.defaultModel],
        },
      }),
    },
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    }),
  };
}

function createLinearMcpDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof LinearConnectorBindingConfigSchema
> {
  function createLinearMcpRoute(input: {
    connectionId: string;
  }): NonNullable<CompileBindingResult["egressRoutes"][number]> {
    return {
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
        kind: "integration_connection",
        connectionId: input.connectionId,
        secretType: "api_key",
      },
    };
  }

  return {
    familyId: "linear",
    variantId: "linear-default",
    kind: "connector",
    displayName: "Linear",
    logoKey: "linear",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: LinearConnectorBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    mcp: (input) =>
      input.binding.config.tools.includes("linear-mcp")
        ? [
            {
              serverId: "linear-default",
              serverName: "linear",
              transport: "streamable-http",
              url: "https://linear.app/mcp",
            },
          ]
        : [],
    compileBinding: (input) => ({
      egressRoutes: [
        {
          match: {
            hosts: ["api.linear.app"],
            methods: ["POST"],
            pathPrefixes: ["/graphql"],
          },
          upstream: {
            baseUrl: "https://api.linear.app",
          },
          authInjection: {
            type: "header",
            target: "authorization",
          },
          credentialResolver: {
            kind: "integration_connection",
            connectionId: input.connection.id,
            secretType: "api_key",
          },
        },
        ...(input.binding.config.tools.includes("linear-mcp")
          ? [
              createLinearMcpRoute({
                connectionId: input.connection.id,
              }),
            ]
          : []),
      ],
      artifacts: [],
      runtimeClients: [],
    }),
  };
}

function createLinearDuplicateNameMcpDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof LinearConnectorBindingConfigSchema
> {
  return {
    familyId: "linear",
    variantId: "linear-duplicate-name",
    kind: "connector",
    displayName: "Linear Duplicate",
    logoKey: "linear",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: LinearConnectorBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    mcp: (input) =>
      input.binding.config.tools.includes("linear-mcp")
        ? [
            {
              serverId: "linear-duplicate-name",
              serverName: "linear",
              transport: "streamable-http",
              url: "https://duplicate.example.com/mcp",
            },
          ]
        : [],
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
  typeof ConnectorBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "connector",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: ConnectorBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "codex-cli",
          name: "Codex CLI",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.install({
                repository: "openai/codex",
                release: {
                  kind: "latest",
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
              }),
            ],
          },
        },
      ],
      runtimeClients: [],
    }),
  };
}

function createPinnedGithubReleaseArtifactDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof ConnectorBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "connector",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: ConnectorBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "codex-cli",
          name: "Codex CLI",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.install({
                repository: "openai/codex",
                release: {
                  kind: "tag",
                  match: "exact",
                  tag: "rust-v0.119.0",
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
              }),
            ],
          },
        },
      ],
      runtimeClients: [],
    }),
  };
}

function createCanonicalGithubReleaseInstallArtifactDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof ConnectorBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "connector",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: ConnectorBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "codex-cli",
          name: "Codex CLI",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.install({
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
                timeoutMs: 90_000,
              }),
            ],
          },
        },
      ],
      runtimeClients: [],
    }),
  };
}

function createTaggedGithubReleaseArtifactDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof ConnectorBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "connector",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: ConnectorBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "jira-cli",
          name: "Jira CLI",
          lifecycle: {
            install: ({ refs }) => [
              refs.githubReleases.install({
                repository: "mistlehq/tools",
                release: {
                  kind: "tag",
                  match: "latest_matching_prefix",
                  prefix: "jira/",
                },
                asset: {
                  kind: "exact",
                  fileName: "jira-linux-amd64",
                  format: "binary",
                },
                installPath: "/usr/local/bin/jira",
                timeoutMs: 120_000,
              }),
            ],
          },
        },
      ],
      runtimeClients: [],
    }),
  };
}

function createTypedMiseInstallArtifactDefinition(): IntegrationDefinition<
  typeof OpenAiTargetConfigSchema,
  typeof EmptyTargetSecretsSchema,
  typeof ConnectorBindingConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: "connector",
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: OpenAiTargetConfigSchema,
    targetSecretSchema: EmptyTargetSecretsSchema,
    bindingConfigSchema: ConnectorBindingConfigSchema,
    connectionMethods: ApiKeyConnectionMethods,
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [
        {
          artifactKey: "typed-mise-cli",
          name: "Typed Mise CLI",
          lifecycle: {
            install: [
              {
                op: "mise_install",
                tools: ["node@22.0.0"],
              },
            ],
          },
        },
      ],
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
      definitions: createDefinitionsBundle(registry),
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
              runtime: {
                runtimeId: "codex",
                config: {},
              },
              model: {
                defaultModel: "gpt-5.3-codex",
                options: {},
              },
            },
          },
        },
      ],
    });

    expect(runtimePlan.sandboxProfileId).toBe("sbp_123");
    expect(runtimePlan.version).toBe(12);
    expect(runtimePlan.egressRoutes).toHaveLength(1);
    expect(runtimePlan.egressRoutes[0]).toMatchObject({
      egressRuleId: "egress_rule_bind_openai_agent",
      bindingId: "bind_openai_agent",
      familyId: "openai",
      variantId: "openai-default",
    });
    expect(runtimePlan.artifacts).toHaveLength(1);
    expect(runtimePlan.artifacts[0]?.artifactKey).toBe("codex-cli");
    expect(runtimePlan.artifacts[0]?.name).toBe("Codex CLI");
    expect(runtimePlan.artifacts[0]?.lifecycle.install).toHaveLength(2);
    const codexInstallCommand = expectTypedInstallStep(
      runtimePlan.artifacts[0]?.lifecycle.install[0],
    );
    expect(codexInstallCommand).toEqual({
      op: "github_release_install",
      repository: "openai/codex",
      release: {
        kind: "latest",
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
    });
    expect(expectTypedInstallStep(runtimePlan.artifacts[0]?.lifecycle.install[1])).toEqual({
      op: "exec",
      command: {
        args: ["echo", "binding:bind_openai_agent"],
      },
    });
    expect(runtimePlan.artifacts[0]?.env).toEqual({
      GH_TOKEN: "dummy-token",
    });
    expect(runtimePlan.runtimeClients).toHaveLength(1);
    expect(runtimePlan.runtimeClients[0]?.setup.env.OPENAI_BASE_URL).toBe("https://api.openai.com");
    expect(runtimePlan.runtimeClients[0]?.processes).toEqual([
      {
        processKey: "codex-app-server",
        command: {
          args: ["/usr/local/bin/codex", "app-server", "--listen", "ws://127.0.0.1:4747"],
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
            args: [],
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
                kind: "threadId",
              },
            ],
          },
        },
      },
    ]);
  });

  it("preserves request middleware declared by compiled egress routes", () => {
    const registry = new IntegrationRegistry();
    registry.register({
      familyId: "github",
      variantId: "github-cloud",
      kind: "connector",
      displayName: "GitHub",
      logoKey: "github",
      targetConfigSchema: OpenAiTargetConfigSchema,
      targetSecretSchema: EmptyTargetSecretsSchema,
      bindingConfigSchema: ConnectorBindingConfigSchema,
      connectionMethods: ApiKeyConnectionMethods,
      compileBinding: (input) => ({
        egressRoutes: [
          {
            match: {
              hosts: ["api.github.com"],
              pathPrefixes: ["/repos"],
              methods: ["POST"],
            },
            upstream: {
              baseUrl: "https://api.github.com",
            },
            authInjection: {
              type: "bearer",
              target: "authorization",
            },
            credentialResolver: {
              kind: "integration_connection",
              connectionId: input.connection.id,
              secretType: "api_key",
            },
            requestMiddleware: ["append-session-link-to-github-markdown"],
          },
        ],
        artifacts: [],
        runtimeClients: [],
      }),
    });

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      definitions: createDefinitionsBundle(registry),
      bindings: [
        {
          targetKey: "github-cloud",
          target: {
            familyId: "github",
            variantId: "github-cloud",
            enabled: true,
            config: {
              apiBaseUrl: "https://api.github.com",
            },
            secrets: {},
          },
          connection: {
            id: "conn_github_org_123",
            status: "active",
            config: {},
          },
          binding: {
            id: "bind_github_connector",
            kind: "connector",
            connectionId: "conn_github_org_123",
            config: {
              defaultModel: "unused",
            },
          },
        },
      ],
    });

    expect(runtimePlan.egressRoutes).toContainEqual(
      expect.objectContaining({
        egressRuleId: "egress_rule_bind_github_connector",
        bindingId: "bind_github_connector",
        familyId: "github",
        variantId: "github-cloud",
        requestMiddleware: ["append-session-link-to-github-markdown"],
      }),
    );
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
      definitions: createDefinitionsBundle(registry),
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
            kind: "connector",
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
    const latestBinaryInstallCommand = expectTypedInstallStep(
      runtimePlan.artifacts[0]?.lifecycle.install[0],
    );
    expect(latestBinaryInstallCommand).toEqual({
      op: "github_release_install",
      repository: "openai/codex",
      release: {
        kind: "latest",
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
    });
  });

  it("supports pinned github release binary install refs in artifact lifecycle hooks", () => {
    const registry = new IntegrationRegistry();
    registry.register(createPinnedGithubReleaseArtifactDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      definitions: createDefinitionsBundle(registry),
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
            kind: "connector",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
      ],
    });

    expect(expectTypedInstallStep(runtimePlan.artifacts[0]?.lifecycle.install[0])).toEqual({
      op: "github_release_install",
      repository: "openai/codex",
      release: {
        kind: "tag",
        match: "exact",
        tag: "rust-v0.119.0",
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
    });
  });

  it("supports the canonical github release install ref in artifact lifecycle hooks", () => {
    const registry = new IntegrationRegistry();
    registry.register(createCanonicalGithubReleaseInstallArtifactDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      definitions: createDefinitionsBundle(registry),
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
            kind: "connector",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
      ],
    });

    expect(expectTypedInstallStep(runtimePlan.artifacts[0]?.lifecycle.install[0])).toEqual({
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
      timeoutMs: 90_000,
    });
  });

  it("supports tagged github release asset install refs in artifact lifecycle hooks", () => {
    const registry = new IntegrationRegistry();
    registry.register(createTaggedGithubReleaseArtifactDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      definitions: createDefinitionsBundle(registry),
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
            kind: "connector",
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
    const taggedAssetInstallCommand = expectTypedInstallStep(
      runtimePlan.artifacts[0]?.lifecycle.install[0],
    );
    expect(taggedAssetInstallCommand).toEqual({
      op: "github_release_install",
      repository: "mistlehq/tools",
      release: {
        kind: "tag",
        match: "latest_matching_prefix",
        prefix: "jira/",
      },
      asset: {
        kind: "exact",
        fileName: "jira-linux-amd64",
        format: "binary",
      },
      installPath: "/usr/local/bin/jira",
      timeoutMs: 120_000,
    });
  });

  it("emits typed mise install steps into compiled runtime plans", () => {
    const registry = new IntegrationRegistry();
    registry.register(createTypedMiseInstallArtifactDefinition());

    const runtimePlan = compileRuntimePlan({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 12,
      image: {
        source: "base",
        imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
      },
      definitions: createDefinitionsBundle(registry),
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
            kind: "connector",
            connectionId: "conn_openai_org_123",
            config: {
              defaultModel: "gpt-5.3-codex",
            },
          },
        },
      ],
    });

    expect(expectTypedInstallStep(runtimePlan.artifacts[0]?.lifecycle.install[0])).toEqual({
      op: "mise_install",
      tools: ["node@22.0.0"],
    });
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
      definitions: createDefinitionsBundle(registry),
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
              runtime: {
                runtimeId: "codex",
                config: {},
              },
              model: {
                defaultModel: "gpt-5.3-codex",
                options: {},
              },
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
              tools: ["linear-mcp"],
            },
          },
        },
      ],
    });

    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      "[mcp_servers.linear]",
    );
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      'url = "https://linear.app/mcp"',
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
      definitions: createDefinitionsBundle(registry),
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
              runtime: {
                runtimeId: "claude-code",
                config: {},
              },
              model: {
                defaultModel: "claude-sonnet",
                options: {},
              },
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
              tools: ["linear-mcp"],
            },
          },
        },
      ],
    });

    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain('"theme": "dark"');
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain('"mcpServers"');
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain('"linear"');
    expect(runtimePlan.runtimeClients[0]?.setup.files[0]?.content).toContain(
      '"url": "https://linear.app/mcp"',
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
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
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
                tools: ["linear-mcp"],
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
                tools: ["linear-mcp"],
              },
            },
          },
        ],
      }),
    ).toThrow(IntegrationCompilerError);

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 12,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
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
                tools: ["linear-mcp"],
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
                tools: ["linear-mcp"],
              },
            },
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.MCP_CONFLICT });
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
        definitions: createDefinitionsBundle(registry),
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
    ).toThrow(IntegrationCompilerError);

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: createDefinitionsBundle(registry),
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
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.TARGET_DISABLED });
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
        definitions: createDefinitionsBundle(registry),
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
    ).toThrow(IntegrationCompilerError);

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: createDefinitionsBundle(registry),
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
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.CONNECTION_MISMATCH });
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
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
              },
            },
          },
        ],
      }),
    ).toThrow(IntegrationCompilerError);

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
              },
            },
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.INVALID_TARGET_CONFIG });
  });

  it("fails when target secrets do not satisfy schema", () => {
    const targetSecretSchema = z.object({
      webhookSecret: z.string().min(1),
    });

    const definition: IntegrationDefinition<
      typeof OpenAiTargetConfigSchema,
      typeof targetSecretSchema,
      typeof AgentBindingConfigSchema
    > = {
      familyId: "openai",
      variantId: "openai-default",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema: OpenAiTargetConfigSchema,
      targetSecretSchema,
      bindingConfigSchema: AgentBindingConfigSchema,
      connectionMethods: ApiKeyConnectionMethods,
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
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
              },
            },
          },
        ],
      }),
    ).toThrow(IntegrationCompilerError);

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
              },
            },
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.INVALID_TARGET_SECRETS });
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
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "",
                  options: {},
                },
              },
            },
          },
        ],
      }),
    ).toThrow(IntegrationCompilerError);

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "",
                  options: {},
                },
              },
            },
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.INVALID_BINDING_CONFIG });
  });

  it("fails when the selected agent runtime is not registered", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: {
          integrationRegistry: registry,
          agentRuntimeRegistry: new AgentRuntimeRegistry(),
        },
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
              },
            },
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.AGENT_RUNTIME_NOT_FOUND });
  });

  it("fails when agent runtime config does not satisfy the runtime schema", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());
    const agentRuntimeRegistry = new AgentRuntimeRegistry();
    agentRuntimeRegistry.register({
      runtimeId: "codex",
      displayName: "Codex",
      configSchema: z.object({
        approvalPolicy: z.literal("never"),
      }),
      createConversationProvider: () => NoopConversationProvider,
      compileRuntime: () => ({
        runtimeClients: [],
        agentRuntimes: [],
      }),
    });

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: {
          integrationRegistry: registry,
          agentRuntimeRegistry,
        },
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
              },
            },
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.INVALID_AGENT_RUNTIME_CONFIG });
  });

  it("fails when an agent provider does not resolve provider access", () => {
    const registry = new IntegrationRegistry();
    registry.register({
      familyId: "openai",
      variantId: "openai-default",
      kind: "agent",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema: OpenAiTargetConfigSchema,
      targetSecretSchema: EmptyTargetSecretsSchema,
      bindingConfigSchema: AgentBindingConfigSchema,
      connectionMethods: ApiKeyConnectionMethods,
      compileBinding: () => ({
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [],
      }),
    });

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: createDefinitionsBundle(registry),
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
              },
            },
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({ code: CompilerErrorCodes.MISSING_AGENT_PROVIDER_ACCESS });
  });

  it("fails when runtime-owned MCP materialization targets a missing client file", () => {
    const registry = new IntegrationRegistry();
    registry.register(createOpenAiDefinition());
    registry.register(createLinearMcpDefinition());
    const agentRuntimeRegistry = new AgentRuntimeRegistry();
    agentRuntimeRegistry.register({
      runtimeId: "codex",
      displayName: "Codex",
      configSchema: z.object({}).strict(),
      createConversationProvider: () => NoopConversationProvider,
      materializeMcpConfig: () => [
        {
          clientId: "missing-client",
          fileId: "missing-file",
          format: IntegrationMcpConfigFormats.TOML,
          path: ["mcp_servers"],
        },
      ],
      compileRuntime: () => ({
        runtimeClients: [
          {
            clientId: "codex-cli",
            setup: {
              env: {},
              files: [
                {
                  fileId: "codex_config",
                  path: "/root/.codex/config.toml",
                  mode: 384,
                  content: "",
                },
              ],
            },
            processes: [],
            endpoints: [
              {
                endpointKey: "app-server",
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
                args: [],
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
                    kind: "threadId",
                  },
                ],
              },
            },
          },
        ],
      }),
    });

    let caughtError: unknown;
    try {
      compileRuntimePlan({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        image: {
          source: "base",
          imageRef: "127.0.0.1:5001/mistle/sandbox-base:dev",
        },
        definitions: {
          integrationRegistry: registry,
          agentRuntimeRegistry,
        },
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
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
                model: {
                  defaultModel: "gpt-5.3-codex",
                  options: {},
                },
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
                tools: ["linear-mcp"],
              },
            },
          },
        ],
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationCompilerError);
    expect(caughtError).toMatchObject({
      code: CompilerErrorCodes.AGENT_RUNTIME_MCP_TARGET_CLIENT_MISSING,
    });
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
      kind: "connector",
      displayName: "OpenAI",
      logoKey: "openai",
      targetConfigSchema,
      targetSecretSchema: EmptyTargetSecretsSchema,
      bindingConfigSchema,
      connectionMethods: ApiKeyConnectionMethods,
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
                BINDING_ID: input.binding.id,
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
      definitions: createDefinitionsBundle(registry),
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
            kind: "connector",
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
            BINDING_ID: "bind_openai_agent",
          },
          files: [],
        },
        processes: [],
        endpoints: [],
      },
    ]);
  });
});
