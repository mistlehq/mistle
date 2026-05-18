import {
  type CompileAgentRuntimeInput,
  type CompileAgentRuntimeResult,
  type EgressCredentialRoute,
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
const CodexCliVersion = "0.130.0";
const CodexCliReleaseTag = `rust-v${CodexCliVersion}`;
const ProxyModelProviderKey = "proxy";
const ProxyModelProviderName = "OpenAI";
const CodexConfigPath = "/etc/codex/config.toml";
const CodexGlobalAgentsPath = "/root/.codex/AGENTS.md";
const CodexGlobalAgentsMd = [
  "Mistle-managed sandbox context:",
  "",
  "- This runtime operates behind a managed outbound proxy.",
  "- Network tools and scripts should use the sandbox's existing proxy configuration rather than expecting direct outbound access.",
  "- Provider credentials may be injected by the platform outside the sandboxed process environment.",
  "- Do not assume missing API keys or auth-related environment variables inside the sandbox mean authentication is misconfigured.",
  "- Prefer debugging request behavior and proxy-mediated access before treating missing in-process credentials as the root cause.",
  "- Do not modify proxy-related environment variables unless explicitly instructed.",
  "- When interacting with external systems, prefer the provider CLI available in the environment over ad hoc HTTP requests or raw `curl`.",
  "- Use `cmddir search <pattern>` to discover relevant commands progressively before reaching for lower-level approaches.",
  "- Examples:",
  "  - `cmddir search '^gh$'`",
  "  - `cmddir search '^(jira|slack)$'`",
].join("\n");
const CodexGitHubRepository = "openai/codex";
const CodexGitHubAssets = {
  x86_64: {
    fileName: "codex-x86_64-unknown-linux-musl.tar.gz",
    binaryPath: "codex-x86_64-unknown-linux-musl",
  },
  aarch64: {
    fileName: "codex-aarch64-unknown-linux-musl.tar.gz",
    binaryPath: "codex-aarch64-unknown-linux-musl",
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

function renderCodexGlobalAgentsMd(): string {
  return `${CodexGlobalAgentsMd}\n`;
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
      content: renderCodexGlobalAgentsMd(),
    },
  ];
}

function buildCodexSetupFilesFromEgressRoutes(input: {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
}): ReadonlyArray<RuntimeClientSetupFile> {
  const providerMetadata = resolveCodexProviderMetadataFromEgressRoutes({
    egressRoutes: input.egressRoutes,
  });

  return buildCodexSetupFiles(providerMetadata === undefined ? {} : { providerMetadata });
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
                },
                aarch64: {
                  fileName: CodexGitHubAssets.aarch64.fileName,
                  format: "tar.gz",
                  extractedPath: CodexGitHubAssets.aarch64.binaryPath,
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
        setupFiles: buildCodexSetupFilesFromEgressRoutes({ egressRoutes }),
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
