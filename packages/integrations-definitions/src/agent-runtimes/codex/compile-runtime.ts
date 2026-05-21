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
import { renderMistleManagedSandboxContext } from "../shared/managed-instructions.js";
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
const CodexCliVersion = "0.132.0";
const CodexCliReleaseTag = `rust-v${CodexCliVersion}`;
const ProxyModelProviderKey = "proxy";
const ProxyModelProviderName = "OpenAI";
const CodexConfigPath = "/etc/codex/config.toml";
const CodexGlobalAgentsPath = "/root/.codex/AGENTS.md";
const CodexGitHubRepository = "openai/codex";
const CodexGitHubAssets = {
  x86_64: {
    fileName: "codex-x86_64-unknown-linux-musl.tar.gz",
    binaryPath: "codex-x86_64-unknown-linux-musl",
    sha256: "8b64432ee4ef5b1d7d197aad4535a276bc85223f4e4163769c0e1015cda883b2",
  },
  aarch64: {
    fileName: "codex-aarch64-unknown-linux-musl.tar.gz",
    binaryPath: "codex-aarch64-unknown-linux-musl",
    sha256: "ae80a8ffb41abfca4eba9746cd3ba90403d57b02bdbcd68455f560890ad9f440",
  },
};
const ArtifactCommandTimeoutMs = 120_000;
const RuntimeClientProcessReadinessTimeoutMs = 60_000;
const RuntimeClientProcessStopTimeoutMs = 10_000;
const RuntimeClientProcessStopGracePeriodMs = 2_000;
type CodexProviderMetadata = {
  responsesApiBaseUrl: string;
  chatgptBaseUrl?: string;
};

function renderCodexConfig(input: { providerMetadata?: CodexProviderMetadata }): string {
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
      plugins: false,
      tool_search: true,
    },
    projects: {
      "/": {
        trust_level: "trusted",
      },
    },
  });
}

function renderCodexGlobalAgentsMd(input: {
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): string {
  return `${renderMistleManagedSandboxContext({ mcpServers: input.mcpServers })}\n`;
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
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
  providerMetadata?: CodexProviderMetadata;
}): ReadonlyArray<RuntimeClientSetupFile> {
  return [
    {
      fileId: "codex_config",
      path: CodexConfigPath,
      mode: 384,
      writeMode: "if-absent",
      content:
        input.providerMetadata === undefined
          ? renderCodexConfig({})
          : renderCodexConfig({ providerMetadata: input.providerMetadata }),
    },
    {
      fileId: "codex_global_agents",
      path: CodexGlobalAgentsPath,
      mode: 384,
      writeMode: "if-absent",
      content: renderCodexGlobalAgentsMd({ mcpServers: input.mcpServers }),
    },
  ];
}

function buildCodexSetupFilesFromEgressRoutes(input: {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<RuntimeClientSetupFile> {
  const providerMetadata = resolveCodexProviderMetadataFromEgressRoutes({
    egressRoutes: input.egressRoutes,
  });

  return buildCodexSetupFiles({
    mcpServers: input.mcpServers,
    ...(providerMetadata === undefined ? {} : { providerMetadata }),
  });
}

function buildCodexRuntimeClients(input: {
  codexCliInstallPath: string;
  setupFiles: ReadonlyArray<RuntimeClientSetupFile>;
}): ReadonlyArray<RuntimeClient> {
  return [
    {
      clientId: "codex-cli",
      setup: {
        env: {},
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

export function compileCodexRuntime(
  input: CompileAgentRuntimeInput<Record<string, never>>,
): CompileAgentRuntimeResult {
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
        setupFiles: buildCodexSetupFilesFromEgressRoutes({
          egressRoutes,
          mcpServers: input.mcpServers,
        }),
      }),
    agentRuntimes: [
      {
        runtimeId: "codex",
        runtimeKey: CodexAppServerProcessKey,
        clientId: "codex-cli",
        endpointKey: CodexAppServerEndpointKey,
        ptyLaunch: CodexPtyLaunchSpec,
      },
    ],
  };
}
