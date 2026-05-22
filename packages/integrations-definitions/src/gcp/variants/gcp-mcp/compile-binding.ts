import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { compileRemoteMcpServerEgressRoutes } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GcpCredentialSecretTypes, GcpCredentialSlotKeys } from "./auth.js";
import type { GcpBindingConfig } from "./binding-config-schema.js";
import { GcpMcpServerCatalog } from "./mcp-catalog.js";
import type { GcpTargetConfig } from "./target-config-schema.js";

export type GcpCompileBindingInput = CompileBindingInput<GcpTargetConfig, GcpBindingConfig>;

export function compileGcpBinding(input: GcpCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: compileRemoteMcpServerEgressRoutes({
      catalog: GcpMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "integration_connection",
        connectionId: input.connection.id,
        secretType: GcpCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
        slotKey: GcpCredentialSlotKeys.accessToken,
      },
    }),
    artifacts: [],
    runtimeClients: [],
  };
}
