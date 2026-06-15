import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { KimiCredentialSlotKeys, resolveKimiCredentialSecretType } from "./auth.js";
import type { KimiBindingConfig } from "./binding-config-schema.js";
import {
  KimiApiBaseUrl,
  KimiApiHost,
  KimiApiPathPrefix,
  type KimiTargetConfig,
} from "./target-config-schema.js";

export type KimiCompileBindingInput = CompileBindingInput<KimiTargetConfig, KimiBindingConfig>;

export function compileKimiBinding(input: KimiCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: [
      {
        match: {
          hosts: [KimiApiHost],
          pathPrefixes: [KimiApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: KimiApiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: resolveKimiCredentialSecretType(input.connection.config),
          slotKey: KimiCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
