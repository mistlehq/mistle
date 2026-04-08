import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { LinearCredentialSlotKeys, resolveLinearCredentialSecretType } from "./auth.js";
import type { LinearBindingConfig } from "./binding-config-schema.js";
import type { LinearTargetConfig } from "./target-config-schema.js";

export type LinearCompileBindingInput = CompileBindingInput<
  LinearTargetConfig,
  LinearBindingConfig
>;

const LinearMcpBaseUrl = "https://mcp.linear.app/mcp";
const LinearMcpHost = "mcp.linear.app";

export function compileLinearBinding(input: LinearCompileBindingInput): CompileBindingResult {
  const credentialSecretType = resolveLinearCredentialSecretType(input.connection.config);

  return {
    egressRoutes: [
      {
        match: {
          hosts: [LinearMcpHost],
        },
        upstream: {
          baseUrl: LinearMcpBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: input.connection.id,
          secretType: credentialSecretType,
          slotKey: LinearCredentialSlotKeys.API_KEY,
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
  };
}
