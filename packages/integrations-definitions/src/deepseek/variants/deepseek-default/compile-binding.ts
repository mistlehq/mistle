import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { DeepSeekCredentialSlotKeys, resolveDeepSeekCredentialSecretType } from "./auth.js";
import type { DeepSeekBindingConfig } from "./binding-config-schema.js";
import {
  DeepSeekApiBaseUrl,
  DeepSeekApiHost,
  DeepSeekApiPathPrefix,
  type DeepSeekTargetConfig,
} from "./target-config-schema.js";

export type DeepSeekCompileBindingInput = CompileBindingInput<
  DeepSeekTargetConfig,
  DeepSeekBindingConfig
>;

export function compileDeepSeekBinding(input: DeepSeekCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: [
      {
        match: {
          hosts: [DeepSeekApiHost],
          pathPrefixes: [DeepSeekApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: DeepSeekApiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: resolveDeepSeekCredentialSecretType(input.connection.config),
          slotKey: DeepSeekCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
