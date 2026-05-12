import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { AnthropicCredentialSlotKeys, resolveAnthropicCredentialSecretType } from "./auth.js";
import type { AnthropicBindingConfig } from "./binding-config-schema.js";
import {
  AnthropicApiBaseUrl,
  AnthropicApiHost,
  AnthropicApiPathPrefix,
  type AnthropicTargetConfig,
} from "./target-config-schema.js";

export type AnthropicCompileBindingInput = CompileBindingInput<
  AnthropicTargetConfig,
  AnthropicBindingConfig
>;

export function compileAnthropicBinding(input: AnthropicCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: [
      {
        match: {
          hosts: [AnthropicApiHost],
          pathPrefixes: [AnthropicApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: AnthropicApiBaseUrl,
        },
        authInjection: {
          type: "header",
          target: "x-api-key",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: resolveAnthropicCredentialSecretType(input.connection.config),
          slotKey: AnthropicCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
