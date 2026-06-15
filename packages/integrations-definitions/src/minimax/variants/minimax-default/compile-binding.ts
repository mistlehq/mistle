import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { MiniMaxCredentialSlotKeys, resolveMiniMaxCredentialSecretType } from "./auth.js";
import type { MiniMaxBindingConfig } from "./binding-config-schema.js";
import {
  MiniMaxAnthropicApiBaseUrl,
  MiniMaxAnthropicApiPathPrefix,
  MiniMaxApiBaseUrl,
  MiniMaxApiHost,
  MiniMaxApiPathPrefix,
  type MiniMaxTargetConfig,
} from "./target-config-schema.js";

export type MiniMaxCompileBindingInput = CompileBindingInput<
  MiniMaxTargetConfig,
  MiniMaxBindingConfig
>;

export function compileMiniMaxBinding(input: MiniMaxCompileBindingInput): CompileBindingResult {
  const credentialResolver = {
    kind: "integration_connection" as const,
    connectionId: input.connection.id,
    secretType: resolveMiniMaxCredentialSecretType(input.connection.config),
    slotKey: MiniMaxCredentialSlotKeys.API_KEY,
  };

  return {
    egressRoutes: [
      {
        match: {
          hosts: [MiniMaxApiHost],
          pathPrefixes: [MiniMaxApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: MiniMaxApiBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver,
      },
      {
        match: {
          hosts: [MiniMaxApiHost],
          pathPrefixes: [MiniMaxAnthropicApiPathPrefix],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: MiniMaxAnthropicApiBaseUrl,
        },
        authInjection: {
          type: "header",
          target: "x-api-key",
        },
        credentialResolver,
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
