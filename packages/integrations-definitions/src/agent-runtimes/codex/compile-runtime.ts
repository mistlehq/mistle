import {
  type CompileAgentRuntimeInput,
  type CompileAgentRuntimeResult,
  type EgressCredentialRoute,
  type ResolvedIntegrationMcpServer,
  type RuntimeClient,
  type RuntimeClientSetupFile,
} from "@mistle/integrations-core";
import { stringify as stringifyToml } from "smol-toml";

import {
  OpenAiChatGptBaseUrl,
  OpenAiChatGptOriginBaseUrl,
  OpenAiChatGptResponsesApiBaseUrl,
} from "../../openai/variants/openai-default/target-config-schema.js";
import {
  type MistleManagedInstructionBlock,
  renderMistleManagedInstructionBlock,
  renderMistleManagedSandboxContext,
  renderMistleManagedSandboxContextBlock,
} from "../shared/managed-instructions.js";
import {
  isOpenAiApiRoute,
  isOpenAiChatGptSubscriptionRoute,
} from "../shared/provider-egress-routes.js";
import {
  CodexAppServerEndpointKey,
  CodexAppServerListenUrl,
  CodexAppServerProcessKey,
  CodexProxyListenUrl,
} from "./app-server.js";
import { CodexPtyLaunchSpec } from "./pty-launch.js";

const CodexCliArtifactKey = "codex-cli";
const CodexCliVersion = "0.142.5";
const CodexCliReleaseTag = `rust-v${CodexCliVersion}`;
const ProxyModelProviderKey = "proxy";
const ProxyModelProviderName = "OpenAI";
const CodexConfigPath = "/etc/codex/config.toml";
const CodexRequirementsPath = "/etc/codex/requirements.toml";
const CodexHomeConfigPath = "/root/.codex/config.toml";
const CodexHomeDir = "/root/.codex";
const CodexGlobalAgentsPath = "/root/.codex/AGENTS.md";
const LangfuseCodexPluginHookCommand =
  'node "${CODEX_HOME:-$HOME/.codex}/plugins/cache/codex-observability-plugin/tracing/0.1.0/dist/index.mjs"';
const CodexGitHubRepository = "openai/codex";
const CodexGitHubAssets = {
  x86_64: {
    fileName: "codex-x86_64-unknown-linux-musl.tar.gz",
    binaryPath: "codex-x86_64-unknown-linux-musl",
    sha256: "cb933ec3cb61bf4b5fc88eecf5e6149829faa6172535b6ef0afb0154beb4aab8",
  },
  aarch64: {
    fileName: "codex-aarch64-unknown-linux-musl.tar.gz",
    binaryPath: "codex-aarch64-unknown-linux-musl",
    sha256: "b18c75c49645918fae23beba0ab41c05f07941601510a2451ba97fe519573c38",
  },
};
const ArtifactCommandTimeoutMs = 120_000;
const RuntimeClientProcessReadinessTimeoutMs = 60_000;
const RuntimeClientProcessStopTimeoutMs = 10_000;
const RuntimeClientProcessStopGracePeriodMs = 2_000;
type CompileCodexRuntimeInput = CompileAgentRuntimeInput<Record<string, never>> & {
  langfuseTracing?: CodexLangfuseTracingConfig;
  managedInstructionBlocks?: ReadonlyArray<MistleManagedInstructionBlock>;
};
type CodexProviderMetadata = {
  responsesApiBaseUrl: string;
  chatgptBaseUrl?: string;
};
type CodexLangfuseTracingConfig = {
  publicKey: string;
  secretKeyPlaceholder: string;
  baseUrl: string;
  environment?: string;
  metadata?: Readonly<Record<string, string>>;
  tags?: ReadonlyArray<string>;
};

function renderCodexConfig(input: {
  langfuseTracing?: CodexLangfuseTracingConfig;
  providerMetadata?: CodexProviderMetadata;
}): string {
  const providerConfig =
    input.providerMetadata === undefined
      ? {}
      : {
          model_provider: ProxyModelProviderKey,
          model_providers: {
            [ProxyModelProviderKey]: {
              name: ProxyModelProviderName,
              base_url: input.providerMetadata.responsesApiBaseUrl,
              wire_api: "responses",
              requires_openai_auth: false,
              supports_websockets: true,
            },
          },
          ...(input.providerMetadata.chatgptBaseUrl === undefined
            ? {}
            : { chatgpt_base_url: input.providerMetadata.chatgptBaseUrl }),
        };

  return stringifyToml({
    ...providerConfig,
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    features: {
      apps: false,
      goals: true,
      ...(input.langfuseTracing === undefined ? {} : { hooks: true }),
      plugins: input.langfuseTracing === undefined ? false : true,
      tool_search: true,
    },
    ...(input.langfuseTracing === undefined
      ? {}
      : {
          plugins: {
            "tracing@codex-observability-plugin": {
              enabled: true,
            },
          },
        }),
    projects: {
      "/": {
        trust_level: "trusted",
      },
    },
  });
}

function renderCodexSetupConfigMergeFragment(): string {
  return stringifyToml({
    features: {
      tool_search: true,
    },
  });
}

function renderCodexHomeLangfuseConfigMergeFragment(): string {
  return stringifyToml({
    features: {
      hooks: true,
      plugins: true,
    },
    plugins: {
      "tracing@codex-observability-plugin": {
        enabled: true,
      },
    },
  });
}

function renderCodexLangfuseRequirementsMergeFragment(): string {
  return stringifyToml({
    features: {
      hooks: true,
    },
    hooks: {
      managed_dir: "/root/.codex/plugins/cache/codex-observability-plugin/tracing/0.1.0",
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: LangfuseCodexPluginHookCommand,
              timeout: 30,
              statusMessage: "Uploading Codex trace to Langfuse",
            },
          ],
        },
      ],
    },
  });
}

function renderCodexGlobalAgentsMd(input: {
  managedInstructionBlocks?: ReadonlyArray<MistleManagedInstructionBlock>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  return `${[
    renderMistleManagedSandboxContext({ mcpServers: input.mcpServers }),
    ...(input.managedInstructionBlocks ?? []).map(renderMistleManagedInstructionBlock),
  ].join("\n\n")}\n`;
}

function renderCodexGlobalAgentsMergeContent(input: {
  managedInstructionBlocks?: ReadonlyArray<MistleManagedInstructionBlock>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  return [
    renderMistleManagedSandboxContextBlock({ mcpServers: input.mcpServers }),
    ...(input.managedInstructionBlocks ?? []).map(renderMistleManagedInstructionBlock),
  ].join("\n\n");
}

function resolveCodexProviderMetadataFromEgressRoutes(input: {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
}): CodexProviderMetadata | undefined {
  const matchingRoutes = input.egressRoutes.filter(
    (route) => isOpenAiApiRoute(route) || isOpenAiChatGptSubscriptionRoute(route),
  );
  const route = matchingRoutes[0];

  if (route === undefined || matchingRoutes[1] !== undefined) {
    return undefined;
  }

  if (isOpenAiChatGptSubscriptionRoute(route)) {
    if (route.upstream.baseUrl !== OpenAiChatGptOriginBaseUrl) {
      return undefined;
    }

    return {
      responsesApiBaseUrl: OpenAiChatGptResponsesApiBaseUrl,
      chatgptBaseUrl: OpenAiChatGptBaseUrl,
    };
  }

  return {
    responsesApiBaseUrl: route.upstream.baseUrl,
  };
}

function buildCodexSetupFiles(input: {
  enableInstalledLangfusePluginConfig?: boolean;
  langfuseTracing?: CodexLangfuseTracingConfig;
  managedInstructionBlocks?: ReadonlyArray<MistleManagedInstructionBlock>;
  mergeSetupFiles?: boolean;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
  providerMetadata?: CodexProviderMetadata;
}): ReadonlyArray<RuntimeClientSetupFile> {
  const installedLangfusePluginConfigFiles: RuntimeClientSetupFile[] =
    input.enableInstalledLangfusePluginConfig === true
      ? [
          {
            fileId: "codex_home_langfuse_config",
            path: CodexHomeConfigPath,
            mode: 384,
            writeMode: "merge",
            content: renderCodexHomeLangfuseConfigMergeFragment(),
          },
        ]
      : [];
  const langfuseManagedHookFiles: RuntimeClientSetupFile[] =
    input.langfuseTracing === undefined
      ? []
      : [
          {
            fileId: "codex_langfuse_requirements",
            path: CodexRequirementsPath,
            mode: 384,
            writeMode: "merge",
            content: renderCodexLangfuseRequirementsMergeFragment(),
          },
        ];

  return [
    {
      fileId: "codex_config",
      path: CodexConfigPath,
      mode: 384,
      writeMode: input.mergeSetupFiles === true ? "merge" : "if-absent",
      content:
        input.mergeSetupFiles === true
          ? renderCodexSetupConfigMergeFragment()
          : renderCodexConfig({
              ...(input.langfuseTracing === undefined
                ? {}
                : { langfuseTracing: input.langfuseTracing }),
              ...(input.providerMetadata === undefined
                ? {}
                : { providerMetadata: input.providerMetadata }),
            }),
    },
    {
      fileId: "codex_global_agents",
      path: CodexGlobalAgentsPath,
      mode: 384,
      writeMode: input.mergeSetupFiles === true ? "merge" : "if-absent",
      content:
        input.mergeSetupFiles === true
          ? renderCodexGlobalAgentsMergeContent({
              ...(input.managedInstructionBlocks === undefined
                ? {}
                : { managedInstructionBlocks: input.managedInstructionBlocks }),
              mcpServers: input.mcpServers,
            })
          : renderCodexGlobalAgentsMd({
              ...(input.managedInstructionBlocks === undefined
                ? {}
                : { managedInstructionBlocks: input.managedInstructionBlocks }),
              mcpServers: input.mcpServers,
            }),
    },
    ...langfuseManagedHookFiles,
    ...installedLangfusePluginConfigFiles,
  ];
}

function buildCodexSetupFilesFromEgressRoutes(input: {
  enableInstalledLangfusePluginConfig?: boolean;
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  langfuseTracing?: CodexLangfuseTracingConfig;
  managedInstructionBlocks?: ReadonlyArray<MistleManagedInstructionBlock>;
  mergeSetupFiles?: boolean;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<RuntimeClientSetupFile> {
  const providerMetadata = resolveCodexProviderMetadataFromEgressRoutes({
    egressRoutes: input.egressRoutes,
  });

  return buildCodexSetupFiles({
    ...(input.enableInstalledLangfusePluginConfig === undefined
      ? {}
      : { enableInstalledLangfusePluginConfig: input.enableInstalledLangfusePluginConfig }),
    ...(input.langfuseTracing === undefined ? {} : { langfuseTracing: input.langfuseTracing }),
    ...(input.managedInstructionBlocks === undefined
      ? {}
      : { managedInstructionBlocks: input.managedInstructionBlocks }),
    ...(input.mergeSetupFiles === undefined ? {} : { mergeSetupFiles: input.mergeSetupFiles }),
    mcpServers: input.mcpServers,
    ...(providerMetadata === undefined ? {} : { providerMetadata }),
  });
}

function buildCodexRuntimeClients(input: {
  codexCliInstallPath: string;
  langfuseTracing?: CodexLangfuseTracingConfig;
  setupFiles: ReadonlyArray<RuntimeClientSetupFile>;
}): ReadonlyArray<RuntimeClient> {
  return [
    {
      clientId: "codex-cli",
      setup: {
        env: buildCodexRuntimeEnv(input),
        files: input.setupFiles,
      },
      processes: [
        {
          processKey: CodexAppServerProcessKey,
          command: {
            args: [input.codexCliInstallPath, "app-server", "--listen", CodexAppServerListenUrl],
          },
          readiness: {
            type: "ws",
            url: CodexAppServerListenUrl,
            timeoutMs: RuntimeClientProcessReadinessTimeoutMs,
          },
          stop: {
            signal: "sigterm",
            timeoutMs: RuntimeClientProcessStopTimeoutMs,
            gracePeriodMs: RuntimeClientProcessStopGracePeriodMs,
          },
        },
      ],
      endpoints: [
        {
          endpointKey: CodexAppServerEndpointKey,
          processKey: CodexAppServerProcessKey,
          transport: {
            type: "ws",
            url: CodexProxyListenUrl,
          },
          connectionMode: "dedicated",
        },
      ],
    },
  ];
}

function buildCodexRuntimeEnv(input: {
  langfuseTracing?: CodexLangfuseTracingConfig;
}): Record<string, string> {
  if (input.langfuseTracing === undefined) {
    return {};
  }

  return {
    CODEX_HOME: CodexHomeDir,
    TRACE_TO_LANGFUSE: "true",
    LANGFUSE_CODEX_PUBLIC_KEY: input.langfuseTracing.publicKey,
    LANGFUSE_CODEX_SECRET_KEY: input.langfuseTracing.secretKeyPlaceholder,
    LANGFUSE_CODEX_BASE_URL: input.langfuseTracing.baseUrl,
    ...(input.langfuseTracing.environment === undefined
      ? {}
      : { LANGFUSE_TRACING_ENVIRONMENT: input.langfuseTracing.environment }),
    ...(input.langfuseTracing.tags === undefined
      ? {}
      : { LANGFUSE_CODEX_TAGS: input.langfuseTracing.tags.join(",") }),
    ...(input.langfuseTracing.metadata === undefined
      ? {}
      : { LANGFUSE_CODEX_METADATA: JSON.stringify(input.langfuseTracing.metadata) }),
  };
}

export function compileCodexRuntime(input: CompileCodexRuntimeInput): CompileAgentRuntimeResult {
  const codexCliInstallPath = input.refs.artifactBinPath("codex");

  return {
    artifacts: [
      {
        artifactKey: CodexCliArtifactKey,
        name: "Codex CLI",
        lifecycle: {
          install: ({ refs }) => [
            refs.githubReleases.install({
              repository: CodexGitHubRepository,
              release: {
                kind: "tag",
                match: "exact",
                tag: CodexCliReleaseTag,
              },
              asset: {
                kind: "by_arch",
                x86_64: {
                  fileName: CodexGitHubAssets.x86_64.fileName,
                  format: "tar.gz",
                  extractedPath: CodexGitHubAssets.x86_64.binaryPath,
                  sha256: CodexGitHubAssets.x86_64.sha256,
                },
                aarch64: {
                  fileName: CodexGitHubAssets.aarch64.fileName,
                  format: "tar.gz",
                  extractedPath: CodexGitHubAssets.aarch64.binaryPath,
                  sha256: CodexGitHubAssets.aarch64.sha256,
                },
              },
              installPath: refs.artifactBinPath("codex"),
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
          ],
        },
      },
    ],
    renderRuntimeClients: ({ egressRoutes }) =>
      buildCodexRuntimeClients({
        codexCliInstallPath,
        ...(input.langfuseTracing === undefined ? {} : { langfuseTracing: input.langfuseTracing }),
        setupFiles: buildCodexSetupFilesFromEgressRoutes({
          egressRoutes,
          ...(input.langfuseTracing === undefined
            ? {}
            : { langfuseTracing: input.langfuseTracing }),
          ...(input.managedInstructionBlocks === undefined
            ? {}
            : { managedInstructionBlocks: input.managedInstructionBlocks }),
          ...(input.mergeRuntimeSetupFiles === undefined
            ? {}
            : { mergeSetupFiles: input.mergeRuntimeSetupFiles }),
          mcpServers: input.mcpServers,
        }),
      }),
    agentRuntimes: buildCodexAgentRuntimes(),
  };
}

export function compileInstalledCodexRuntime(input: {
  codexCliPath: string;
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  langfuseTracing?: CodexLangfuseTracingConfig;
  managedInstructionBlocks?: ReadonlyArray<MistleManagedInstructionBlock>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): CompileAgentRuntimeResult {
  return {
    artifacts: [],
    runtimeClients: buildCodexRuntimeClients({
      codexCliInstallPath: input.codexCliPath,
      ...(input.langfuseTracing === undefined ? {} : { langfuseTracing: input.langfuseTracing }),
      setupFiles: buildCodexSetupFilesFromEgressRoutes({
        egressRoutes: input.egressRoutes,
        enableInstalledLangfusePluginConfig: input.langfuseTracing !== undefined,
        ...(input.langfuseTracing === undefined ? {} : { langfuseTracing: input.langfuseTracing }),
        ...(input.managedInstructionBlocks === undefined
          ? {}
          : { managedInstructionBlocks: input.managedInstructionBlocks }),
        mcpServers: input.mcpServers,
      }),
    }),
    agentRuntimes: buildCodexAgentRuntimes(),
  };
}

function buildCodexAgentRuntimes(): CompileAgentRuntimeResult["agentRuntimes"] {
  return [
    {
      runtimeId: "codex",
      runtimeKey: CodexAppServerProcessKey,
      clientId: "codex-cli",
      endpointKey: CodexAppServerEndpointKey,
      ptyLaunch: CodexPtyLaunchSpec,
    },
  ];
}
