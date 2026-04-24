import {
  type AgentProviderAccess,
  type CompileAgentRuntimeInput,
  type CompileAgentRuntimeResult,
} from "@mistle/integrations-core";
import { stringify as stringifyToml } from "smol-toml";

import {
  CodexAppServerEndpointKey,
  CodexAppServerListenUrl,
  CodexAppServerProcessKey,
  CodexProxyListenUrl,
} from "./app-server.js";
import { composeCodexDeveloperInstructions } from "./developer-instructions.js";
import { CodexPtyLaunchSpec } from "./pty-launch.js";

const CodexCliArtifactKey = "codex-cli";
const CodexCliVersion = "0.124.0";
const CodexCliReleaseTag = `rust-v${CodexCliVersion}`;
const ProxyModelProviderKey = "proxy";
const ProxyModelProviderName = "OpenAI";
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
  reasoningEffort: string;
  responsesApiBaseUrl: string;
  chatgptBaseUrl?: string;
  additionalInstructions?: string;
};

function resolveCodexProviderMetadata(
  providerAccess: AgentProviderAccess,
): CodexProviderMetadata | null {
  const providerMetadata = providerAccess.providerMetadata;
  if (providerMetadata === undefined) {
    return null;
  }

  const reasoningEffort = providerMetadata["reasoningEffort"];
  if (typeof reasoningEffort !== "string" || reasoningEffort.trim().length === 0) {
    return null;
  }

  const additionalInstructions = providerMetadata["additionalInstructions"];
  const responsesApiBaseUrl = providerMetadata["responsesApiBaseUrl"];
  const chatgptBaseUrl = providerMetadata["chatgptBaseUrl"];

  if (typeof responsesApiBaseUrl !== "string" || responsesApiBaseUrl.trim().length === 0) {
    return null;
  }

  if (chatgptBaseUrl !== undefined && typeof chatgptBaseUrl !== "string") {
    return null;
  }

  if (additionalInstructions === undefined) {
    return {
      reasoningEffort,
      responsesApiBaseUrl,
      ...(chatgptBaseUrl === undefined ? {} : { chatgptBaseUrl }),
    };
  }

  if (typeof additionalInstructions !== "string") {
    return null;
  }

  return {
    reasoningEffort,
    responsesApiBaseUrl,
    ...(chatgptBaseUrl === undefined ? {} : { chatgptBaseUrl }),
    additionalInstructions,
  };
}

function renderCodexConfig(input: {
  model: string;
  reasoningEffort: string;
  responsesApiBaseUrl: string;
  chatgptBaseUrl?: string;
  additionalInstructions?: string;
}): string {
  return stringifyToml({
    model: input.model,
    model_provider: ProxyModelProviderKey,
    model_reasoning_effort: input.reasoningEffort,
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    developer_instructions: composeCodexDeveloperInstructions({
      bindingAdditionalInstructions: input.additionalInstructions ?? null,
      automationInstructions: null,
    }),
    model_providers: {
      [ProxyModelProviderKey]: {
        name: ProxyModelProviderName,
        base_url: input.responsesApiBaseUrl,
        wire_api: "responses",
        requires_openai_auth: false,
        supports_websockets: false,
      },
    },
    features: {
      apps: false,
      plugins: false,
      tool_search: true,
    },
    ...(input.chatgptBaseUrl === undefined ? {} : { chatgpt_base_url: input.chatgptBaseUrl }),
    projects: {
      "/": {
        trust_level: "trusted",
      },
    },
  });
}

export function compileCodexRuntime(
  input: CompileAgentRuntimeInput<Record<string, never>>,
): CompileAgentRuntimeResult {
  const routeHost = new URL(input.providerAccess.apiBaseUrl).host;
  const codexCliInstallPath = input.refs.artifactBinPath("codex");
  const providerMetadata = resolveCodexProviderMetadata(input.providerAccess);

  if (providerMetadata === null) {
    throw new Error("Codex runtime requires provider reasoning metadata.");
  }

  return {
    egressRoutes: [
      {
        match: {
          hosts: [routeHost],
          pathPrefixes: [...input.providerAccess.allowedPathPrefixes],
          methods: [...input.providerAccess.allowedMethods],
        },
        upstream: {
          baseUrl: input.providerAccess.apiBaseUrl,
        },
        authInjection: {
          type: input.providerAccess.authScheme,
          target: "authorization",
        },
        ...(input.providerAccess.additionalHeaders === undefined
          ? {}
          : { additionalHeaders: input.providerAccess.additionalHeaders }),
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.providerAccess.credentialResolver.connectionId,
          secretType: input.providerAccess.credentialResolver.secretType,
          ...(input.providerAccess.credentialResolver.slotKey === undefined
            ? {}
            : { slotKey: input.providerAccess.credentialResolver.slotKey }),
        },
      },
    ],
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
    runtimeClients: [
      {
        clientId: "codex-cli",
        setup: {
          env: {
            OPENAI_MODEL: input.providerAccess.defaultModel,
            OPENAI_REASONING_EFFORT: providerMetadata.reasoningEffort,
          },
          files: [
            {
              fileId: "codex_config",
              path: "/etc/codex/config.toml",
              mode: 384,
              writeMode: "if-absent",
              content: renderCodexConfig({
                model: input.providerAccess.defaultModel,
                reasoningEffort: providerMetadata.reasoningEffort,
                responsesApiBaseUrl: providerMetadata.responsesApiBaseUrl,
                ...(providerMetadata.chatgptBaseUrl === undefined
                  ? {}
                  : {
                      chatgptBaseUrl: providerMetadata.chatgptBaseUrl,
                    }),
                ...(providerMetadata.additionalInstructions === undefined
                  ? {}
                  : {
                      additionalInstructions: providerMetadata.additionalInstructions,
                    }),
              }),
            },
          ],
        },
        processes: [
          {
            processKey: CodexAppServerProcessKey,
            command: {
              args: [codexCliInstallPath, "app-server", "--listen", CodexAppServerListenUrl],
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
    ],
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
