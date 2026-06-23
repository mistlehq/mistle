import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { compileRemoteMcpServerEgressRoutes } from "../../../shared/remote-mcp-server-catalog/index.js";
import { AutumnCredentialSecretTypes, AutumnCredentialSlotKeys } from "./auth.js";
import type { AutumnBindingConfig } from "./binding-config-schema.js";
import { AutumnMcpServerCatalog } from "./mcp-catalog.js";
import type { AutumnTargetConfig } from "./target-config-schema.js";

export type AutumnCompileBindingInput = CompileBindingInput<
  AutumnTargetConfig,
  AutumnBindingConfig
>;

export function compileAutumnBinding(input: AutumnCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: compileRemoteMcpServerEgressRoutes({
      catalog: AutumnMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "integration_connection",
        connectionId: input.connection.id,
        secretType: AutumnCredentialSecretTypes.API_KEY,
        slotKey: AutumnCredentialSlotKeys.API_KEY,
      },
    }),
    artifacts: [],
    runtimeClients: [],
  };
}
