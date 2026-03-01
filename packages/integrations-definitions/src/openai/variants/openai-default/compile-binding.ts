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
const ArtifactCommandTimeoutMs = 120_000;

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

function renderCodexInstallScript(): string {
  return [
    'arch="$(uname -m)"',
    'case "$arch" in',
    "  x86_64)",
    '    archive_name="codex-x86_64-unknown-linux-musl.tar.gz"',
    '    binary_name="codex-x86_64-unknown-linux-musl"',
    "    ;;",
    "  aarch64|arm64)",
    '    archive_name="codex-aarch64-unknown-linux-musl.tar.gz"',
    '    binary_name="codex-aarch64-unknown-linux-musl"',
    "    ;;",
    "  *)",
    '    echo "Unsupported architecture: $arch" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    "",
    'temp_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$temp_dir\"' EXIT",
    "",
    'curl -fsSL "https://github.com/openai/codex/releases/latest/download/$archive_name" -o "$temp_dir/codex.tar.gz"',
    'tar -xzf "$temp_dir/codex.tar.gz" -C "$temp_dir"',
    `install -m 0755 "$temp_dir/$binary_name" "${CodexCliInstallPath}"`,
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
            refs.command.exec({
              args: ["sh", "-euc", renderCodexInstallScript()],
              timeoutMs: ArtifactCommandTimeoutMs,
            }),
          ],
          update: ({ refs }) => [
            refs.command.exec({
              args: ["sh", "-euc", renderCodexInstallScript()],
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
    runtimeClientSetups: [
      {
        clientId: input.binding.config.runtime,
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
    ],
  };
}
