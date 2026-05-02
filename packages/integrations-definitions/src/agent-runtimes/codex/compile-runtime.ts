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
import { CodexPtyLaunchSpec } from "./pty-launch.js";

const CodexCliArtifactKey = "codex-cli";
const CodexCliVersion = "0.128.0";
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

function resolveCodexProviderMetadata(
  providerAccess: AgentProviderAccess,
): CodexProviderMetadata | null {
  const providerMetadata = providerAccess.providerMetadata;
  if (providerMetadata === undefined) {
    return null;
  }

  const responsesApiBaseUrl = providerMetadata["responsesApiBaseUrl"];
  const chatgptBaseUrl = providerMetadata["chatgptBaseUrl"];

  if (typeof responsesApiBaseUrl !== "string" || responsesApiBaseUrl.trim().length === 0) {
    return null;
  }

  if (chatgptBaseUrl !== undefined && typeof chatgptBaseUrl !== "string") {
    return null;
  }

  return {
    responsesApiBaseUrl,
    ...(chatgptBaseUrl === undefined ? {} : { chatgptBaseUrl }),
  };
}

function renderCodexConfig(input: {
  responsesApiBaseUrl: string;
  chatgptBaseUrl?: string;
}): string {
  return stringifyToml({
    model_provider: ProxyModelProviderKey,
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    model_providers: {
      [ProxyModelProviderKey]: {
        name: ProxyModelProviderName,
        base_url: input.responsesApiBaseUrl,
        wire_api: "responses",
        requires_openai_auth: false,
        supports_websockets: true,
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

function renderCodexGlobalAgentsMd(): string {
  return `${CodexGlobalAgentsMd}\n`;
}

export function compileCodexRuntime(
  input: CompileAgentRuntimeInput<Record<string, never>>,
): CompileAgentRuntimeResult {
  const routeHost = new URL(input.providerAccess.apiBaseUrl).host;
  const codexCliInstallPath = input.refs.artifactBinPath("codex");
  const providerMetadata = resolveCodexProviderMetadata(input.providerAccess);

  if (providerMetadata === null) {
    throw new Error("Codex runtime requires provider URL metadata.");
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
          env: {},
          files: [
            {
              fileId: "codex_config",
              path: CodexConfigPath,
              mode: 384,
              writeMode: "if-absent",
              content: renderCodexConfig({
                responsesApiBaseUrl: providerMetadata.responsesApiBaseUrl,
                ...(providerMetadata.chatgptBaseUrl === undefined
                  ? {}
                  : {
                      chatgptBaseUrl: providerMetadata.chatgptBaseUrl,
                    }),
              }),
            },
            {
              fileId: "codex_global_agents",
              path: CodexGlobalAgentsPath,
              mode: 384,
              writeMode: "if-absent",
              content: renderCodexGlobalAgentsMd(),
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
