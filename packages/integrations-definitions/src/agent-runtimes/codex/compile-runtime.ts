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
} from "./app-server.js";
import { CodexPtyLaunchSpec } from "./pty-launch.js";

const CodexCliArtifactKey = "codex-cli";
const ProxyModelProviderKey = "proxy";
const ProxyModelProviderName = "Proxy";
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
const RuntimeClientProcessReadinessTimeoutMs = 5_000;
const RuntimeClientProcessStopTimeoutMs = 10_000;
const RuntimeClientProcessStopGracePeriodMs = 2_000;
const ManagedSandboxContext = [
  "Mistle-managed sandbox context:",
  "",
  "- This runtime operates behind a managed outbound proxy.",
  "- Network tools and scripts should use the sandbox's existing proxy configuration rather than expecting direct outbound access.",
  "- Provider credentials may be injected by the platform outside the sandboxed process environment.",
  "- Do not assume missing API keys or auth-related environment variables inside the sandbox mean authentication is misconfigured.",
  "- Prefer debugging request behavior and proxy-mediated access before treating missing in-process credentials as the root cause.",
  "- Do not modify proxy-related environment variables unless explicitly instructed.",
].join("\n");

type CodexProviderMetadata = {
  reasoningEffort: string;
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
  if (additionalInstructions === undefined) {
    return {
      reasoningEffort,
    };
  }

  if (typeof additionalInstructions !== "string") {
    return null;
  }

  return {
    reasoningEffort,
    additionalInstructions,
  };
}

function composeDeveloperInstructions(additionalInstructions?: string): string {
  if (additionalInstructions === undefined) {
    return ManagedSandboxContext;
  }

  return [
    ManagedSandboxContext,
    "",
    "User-provided additional instructions:",
    "",
    additionalInstructions,
  ].join("\n");
}

function renderCodexConfig(input: {
  model: string;
  reasoningEffort: string;
  apiBaseUrl: string;
  additionalInstructions?: string;
}): string {
  return stringifyToml({
    model: input.model,
    model_provider: ProxyModelProviderKey,
    model_reasoning_effort: input.reasoningEffort,
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    developer_instructions: composeDeveloperInstructions(input.additionalInstructions),
    model_providers: {
      [ProxyModelProviderKey]: {
        name: ProxyModelProviderName,
        base_url: input.apiBaseUrl,
        wire_api: "responses",
        requires_openai_auth: false,
        supports_websockets: false,
      },
    },
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
        credentialResolver: {
          connectionId: input.providerAccess.credentialResolver.connectionId,
          secretType: input.providerAccess.credentialResolver.secretType,
        },
      },
    ],
    artifacts: [
      {
        artifactKey: CodexCliArtifactKey,
        name: "Codex CLI",
        lifecycle: {
          install: ({ refs }) => [
            refs.githubReleases.installLatestBinary({
              repository: CodexGitHubRepository,
              assets: CodexGitHubAssets,
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
              content: renderCodexConfig({
                model: input.providerAccess.defaultModel,
                reasoningEffort: providerMetadata.reasoningEffort,
                apiBaseUrl: input.providerAccess.apiBaseUrl,
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
              url: CodexAppServerListenUrl,
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
