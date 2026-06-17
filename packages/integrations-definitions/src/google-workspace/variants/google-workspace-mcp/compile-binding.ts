import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { compileRemoteMcpServerEgressRoutes } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GoogleWorkspaceCredentialSecretTypes, GoogleWorkspaceCredentialSlotKeys } from "./auth.js";
import type { GoogleWorkspaceBindingConfig } from "./binding-config-schema.js";
import { GoogleWorkspaceMcpServerCatalog } from "./mcp-catalog.js";
import type { GoogleWorkspaceTargetConfig } from "./target-config-schema.js";

export type GoogleWorkspaceCompileBindingInput = CompileBindingInput<
  GoogleWorkspaceTargetConfig,
  GoogleWorkspaceBindingConfig
>;

export function compileGoogleWorkspaceBinding(
  input: GoogleWorkspaceCompileBindingInput,
): CompileBindingResult {
  return {
    egressRoutes: compileRemoteMcpServerEgressRoutes({
      catalog: GoogleWorkspaceMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "integration_connection",
        connectionId: input.connection.id,
        secretType: GoogleWorkspaceCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
        slotKey: GoogleWorkspaceCredentialSlotKeys.accessToken,
      },
    }),
    artifacts: [],
    runtimeClients: [],
  };
}
