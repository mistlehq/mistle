import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { OpenAiApiKeyCredentialSecretTypes } from "./auth.js";
import type { OpenAiApiKeyBindingConfig } from "./binding-config-schema.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";

export type OpenAiApiKeyCompileBindingInput = CompileBindingInput<
  OpenAiApiKeyTargetConfig,
  OpenAiApiKeyBindingConfig
>;

const CodexCliArtifactKey = "codex-cli";
const CodexCliInstallPath = "/usr/local/bin/codex";
const CodexAppServerProcessKey = "codex-app-server";
const CodexAppServerListenUrl = "ws://127.0.0.1:4500";
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

function resolveRoutePathPrefix(baseUrl: string): string {
  const parsedUrl = new URL(baseUrl);
  const pathname = parsedUrl.pathname;

  if (pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function renderCodexConfig(input: { model: string; reasoningEffort: string }): string {
  return [
    `model = "${input.model}"`,
    `model_reasoning_effort = "${input.reasoningEffort}"`,
    "",
  ].join("\n");
}

export function compileOpenAiApiKeyBinding(
  input: OpenAiApiKeyCompileBindingInput,
): CompileBindingResult {
  const routeHost = new URL(input.target.config.apiBaseUrl).host;
  const routePathPrefix = resolveRoutePathPrefix(input.target.config.apiBaseUrl);

  return {
    egressRoutes: [
      {
        match: {
          hosts: [routeHost],
          pathPrefixes: [routePathPrefix],
          methods: ["POST"],
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
          secretType: OpenAiApiKeyCredentialSecretTypes.API_KEY,
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
              installPath: CodexCliInstallPath,
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
          ],
          update: ({ refs }) => [
            refs.githubReleases.installLatestBinary({
              repository: CodexGitHubRepository,
              assets: CodexGitHubAssets,
              installPath: CodexCliInstallPath,
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
          ],
          remove: ({ refs }) => [
            refs.command.exec({
              args: ["rm", "-f", CodexCliInstallPath],
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
            OPENAI_BASE_URL: input.refs.egressUrl,
            OPENAI_MODEL: input.binding.config.defaultModel,
            OPENAI_REASONING_EFFORT: input.binding.config.reasoningEffort,
          },
          files: [
            {
              fileId: "codex_config",
              path: "/workspace/.codex/config.toml",
              mode: 384,
              content: renderCodexConfig({
                model: input.binding.config.defaultModel,
                reasoningEffort: input.binding.config.reasoningEffort,
              }),
            },
          ],
        },
        processes: [
          {
            processKey: CodexAppServerProcessKey,
            command: {
              args: [CodexCliInstallPath, "app-server", "--listen", CodexAppServerListenUrl],
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
            endpointKey: "app-server",
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
  };
}
