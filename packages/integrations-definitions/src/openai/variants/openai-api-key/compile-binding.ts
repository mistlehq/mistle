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

function createEgressRouteBaseUrl(input: { egressBaseUrl: string; routeId: string }): string {
  const parsedEgressBaseUrl = new URL(input.egressBaseUrl);
  const normalizedBasePath =
    parsedEgressBaseUrl.pathname.endsWith("/") && parsedEgressBaseUrl.pathname !== "/"
      ? parsedEgressBaseUrl.pathname.slice(0, -1)
      : parsedEgressBaseUrl.pathname === "/"
        ? ""
        : parsedEgressBaseUrl.pathname;

  parsedEgressBaseUrl.pathname = `${normalizedBasePath}/routes/${encodeURIComponent(input.routeId)}`;
  parsedEgressBaseUrl.search = "";
  parsedEgressBaseUrl.hash = "";

  return parsedEgressBaseUrl.toString();
}

function renderCodexConfig(input: {
  model: string;
  reasoningEffort: string;
  egressRouteBaseUrl: string;
}): string {
  return [
    `model = "${input.model}"`,
    `model_reasoning_effort = "${input.reasoningEffort}"`,
    `model_provider = "openai"`,
    "",
    "[model_providers.openai]",
    'name = "OpenAI"',
    `base_url = "${input.egressRouteBaseUrl}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    "",
  ].join("\n");
}

export function compileOpenAiApiKeyBinding(
  input: OpenAiApiKeyCompileBindingInput,
): CompiledBindingResult {
  const routeId = `route_${input.binding.id}`;
  const egressRouteBaseUrl = createEgressRouteBaseUrl({
    egressBaseUrl: input.runtimeContext.sandboxdEgressBaseUrl,
    routeId,
  });
  const routeHost = new URL(input.target.config.apiBaseUrl).host;
  const routePathPrefix = resolveRoutePathPrefix(input.target.config.apiBaseUrl);

  return {
    egressRoutes: [
      {
        routeId,
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
          OPENAI_BASE_URL: egressRouteBaseUrl,
          OPENAI_MODEL: input.binding.config.defaultModel,
          OPENAI_REASONING_EFFORT: input.binding.config.reasoningEffort,
        },
        files: [
          {
            path: "/workspace/.codex/config.toml",
            mode: 384,
            content: renderCodexConfig({
              model: input.binding.config.defaultModel,
              reasoningEffort: input.binding.config.reasoningEffort,
              egressRouteBaseUrl,
            }),
          },
        ],
      },
    ],
  };
}
