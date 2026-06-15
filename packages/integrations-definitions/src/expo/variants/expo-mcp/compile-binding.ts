import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { compileRemoteMcpServerEgressRoutes } from "../../../shared/remote-mcp-server-catalog/index.js";
import { ExpoCredentialSecretTypes, ExpoCredentialSlotKeys } from "./auth.js";
import type { ExpoBindingConfig } from "./binding-config-schema.js";
import { ExpoMcpServerCatalog } from "./mcp-catalog.js";

export type ExpoCompileBindingInput = CompileBindingInput<Record<string, never>, ExpoBindingConfig>;

export function compileExpoBinding(input: ExpoCompileBindingInput): CompileBindingResult {
  return {
    egressRoutes: compileRemoteMcpServerEgressRoutes({
      catalog: ExpoMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "integration_connection",
        connectionId: input.connection.id,
        secretType: ExpoCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
        slotKey: ExpoCredentialSlotKeys.accessToken,
      },
    }),
    artifacts: [],
    runtimeClients: [],
  };
}
