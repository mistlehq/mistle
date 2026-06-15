import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { ZaiCredentialSlotKeys, resolveZaiCredentialSecretType } from "./auth.js";
import type { ZaiBindingConfig } from "./binding-config-schema.js";
import {
  ZaiApiBaseUrl,
  ZaiApiHost,
  ZaiApiPathPrefix,
  type ZaiTargetConfig,
} from "./target-config-schema.js";

export type ZaiCompileBindingInput = CompileBindingInput<ZaiTargetConfig, ZaiBindingConfig>;

export function compileZaiBinding(input: ZaiCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: [
      {
        match: {
          hosts: [ZaiApiHost],
          pathPrefixes: [ZaiApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: ZaiApiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: resolveZaiCredentialSecretType(input.connection.config),
          slotKey: ZaiCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
