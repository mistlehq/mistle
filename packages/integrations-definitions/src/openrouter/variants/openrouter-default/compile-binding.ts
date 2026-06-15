import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { OpenRouterCredentialSlotKeys, resolveOpenRouterCredentialSecretType } from "./auth.js";
import type { OpenRouterBindingConfig } from "./binding-config-schema.js";
import {
  OpenRouterApiBaseUrl,
  OpenRouterApiHost,
  OpenRouterApiPathPrefix,
  type OpenRouterTargetConfig,
} from "./target-config-schema.js";

export type OpenRouterCompileBindingInput = CompileBindingInput<
  OpenRouterTargetConfig,
  OpenRouterBindingConfig
>;

export function compileOpenRouterBinding(
  input: OpenRouterCompileBindingInput,
): CompileBindingResult {
  return {
    egressRoutes: [
      {
        match: {
          hosts: [OpenRouterApiHost],
          pathPrefixes: [OpenRouterApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: OpenRouterApiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: resolveOpenRouterCredentialSecretType(input.connection.config),
          slotKey: OpenRouterCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
