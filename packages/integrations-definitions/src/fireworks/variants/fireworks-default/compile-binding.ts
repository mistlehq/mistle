import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { FireworksCredentialSlotKeys, resolveFireworksCredentialSecretType } from "./auth.js";
import type { FireworksBindingConfig } from "./binding-config-schema.js";
import {
  FireworksApiBaseUrl,
  FireworksApiHost,
  FireworksApiPathPrefix,
  type FireworksTargetConfig,
} from "./target-config-schema.js";

export type FireworksCompileBindingInput = CompileBindingInput<
  FireworksTargetConfig,
  FireworksBindingConfig
>;

export function compileFireworksBinding(input: FireworksCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: [
      {
        match: {
          hosts: [FireworksApiHost],
          pathPrefixes: [FireworksApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: FireworksApiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: resolveFireworksCredentialSecretType(input.connection.config),
          slotKey: FireworksCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
