import type { CompileBindingInput, CompiledBindingResult } from "@mistle/integrations-core";

import { OpenAiApiKeyCredentialSecretTypes } from "./auth.js";
import type { OpenAiApiKeyBindingConfig } from "./binding-config-schema.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";

export type OpenAiApiKeyCompileBindingInput = CompileBindingInput<
  OpenAiApiKeyTargetConfig,
  OpenAiApiKeyBindingConfig
>;

function resolveRoutePathPrefix(baseUrl: string): string {
  const parsedUrl = new URL(baseUrl);
  const pathname = parsedUrl.pathname;

  if (pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function renderCodexConfig(input: OpenAiApiKeyCompileBindingInput): string {
  return [
    `model = "${input.binding.config.defaultModel}"`,
    `model_reasoning_effort = "${input.binding.config.reasoningEffort}"`,
    `model_provider = "openai"`,
    "",
    "[model_providers.openai]",
    'name = "OpenAI"',
    `base_url = "${input.target.config.apiBaseUrl}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    "",
  ].join("\n");
}

export function compileOpenAiApiKeyBinding(
  input: OpenAiApiKeyCompileBindingInput,
): CompiledBindingResult {
  const routeHost = new URL(input.target.config.apiBaseUrl).host;
  const routePathPrefix = resolveRoutePathPrefix(input.target.config.apiBaseUrl);

  return {
    egressRoutes: [
      {
        routeId: `route_${input.binding.id}`,
        bindingId: input.binding.id,
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
    artifacts: [],
    runtimeClientSetups: [
      {
        clientId: input.binding.config.runtime,
        env: {
          OPENAI_BASE_URL: input.target.config.apiBaseUrl,
          OPENAI_MODEL: input.binding.config.defaultModel,
          OPENAI_REASONING_EFFORT: input.binding.config.reasoningEffort,
        },
        files: [
          {
            path: "/workspace/.codex/config.toml",
            mode: 384,
            content: renderCodexConfig(input),
          },
        ],
      },
    ],
  };
}
