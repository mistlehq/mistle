import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { OpenCodeGoCredentialSlotKeys, resolveOpenCodeGoCredentialSecretType } from "./auth.js";
import type { OpenCodeGoBindingConfig } from "./binding-config-schema.js";
import {
  OpenCodeGoApiBaseUrl,
  OpenCodeGoApiHost,
  OpenCodeGoApiPathPrefix,
  type OpenCodeGoTargetConfig,
} from "./target-config-schema.js";

export type OpenCodeGoCompileBindingInput = CompileBindingInput<
  OpenCodeGoTargetConfig,
  OpenCodeGoBindingConfig
>;

export function compileOpenCodeGoBinding(
  input: OpenCodeGoCompileBindingInput,
): CompileBindingResult {
  return {
    egressRoutes: [
      {
        match: {
          hosts: [OpenCodeGoApiHost],
          pathPrefixes: [OpenCodeGoApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: OpenCodeGoApiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: resolveOpenCodeGoCredentialSecretType(input.connection.config),
          slotKey: OpenCodeGoCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
