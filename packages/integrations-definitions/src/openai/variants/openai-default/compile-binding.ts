import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";
import { stringify as stringifyToml } from "smol-toml";

import { OpenAiAgentAdapterKeys } from "./adapter-keys.js";
import { resolveOpenAiCredentialSecretType } from "./auth.js";
import type { OpenAiApiKeyBindingConfig } from "./binding-config-schema.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";

export type OpenAiApiKeyCompileBindingInput = CompileBindingInput<
  OpenAiApiKeyTargetConfig,
  OpenAiApiKeyBindingConfig
>;

const CodexCliArtifactKey = "codex-cli";
const CodexAppServerProcessKey = "codex-app-server";
const CodexAppServerEndpointKey = "app-server";
const CodexAppServerListenUrl = "ws://127.0.0.1:4500";
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
const OpenAiAllowedPathPrefix = "/";
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

export function compileOpenAiApiKeyBinding(
  input: OpenAiApiKeyCompileBindingInput,
): CompileBindingResult {
  const routeHost = new URL(input.target.config.apiBaseUrl).host;
  const credentialSecretType = resolveOpenAiCredentialSecretType(input.connection.config);
  const codexCliInstallPath = input.refs.artifactBinPath("codex");

  return {
    egressRoutes: [
      {
        match: {
          hosts: [routeHost],
          pathPrefixes: [OpenAiAllowedPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: input.target.config.apiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: input.connection.id,
          secretType: credentialSecretType,
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
        clientId: input.binding.config.runtime,
        setup: {
          env: {
            OPENAI_MODEL: input.binding.config.defaultModel,
            OPENAI_REASONING_EFFORT: input.binding.config.reasoningEffort,
          },
          files: [
            {
              fileId: "codex_config",
              path: "/etc/codex/config.toml",
              mode: 384,
              content: renderCodexConfig({
                model: input.binding.config.defaultModel,
                reasoningEffort: input.binding.config.reasoningEffort,
                apiBaseUrl: input.target.config.apiBaseUrl,
                ...(input.binding.config.additionalInstructions === undefined
                  ? {}
                  : {
                      additionalInstructions: input.binding.config.additionalInstructions,
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
        runtimeKey: CodexAppServerProcessKey,
        clientId: input.binding.config.runtime,
        endpointKey: CodexAppServerEndpointKey,
        adapterKey: OpenAiAgentAdapterKeys.OPENAI_CODEX,
      },
    ],
  };
}
