import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { InceptionCredentialSlotKeys, resolveInceptionCredentialSecretType } from "./auth.js";
import type { InceptionBindingConfig } from "./binding-config-schema.js";
import {
  InceptionApiBaseUrl,
  InceptionApiHost,
  InceptionApiPathPrefix,
  type InceptionTargetConfig,
} from "./target-config-schema.js";

export type InceptionCompileBindingInput = CompileBindingInput<
  InceptionTargetConfig,
  InceptionBindingConfig
>;

export function compileInceptionBinding(input: InceptionCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: [
      {
        match: {
          hosts: [InceptionApiHost],
          pathPrefixes: [InceptionApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: InceptionApiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: resolveInceptionCredentialSecretType(input.connection.config),
          slotKey: InceptionCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
