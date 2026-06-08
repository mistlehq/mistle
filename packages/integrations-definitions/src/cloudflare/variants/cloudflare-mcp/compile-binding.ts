import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { compileRemoteMcpServerEgressRoutes } from "../../../shared/remote-mcp-server-catalog/index.js";
import { CloudflareCredentialSecretTypes, CloudflareCredentialSlotKeys } from "./auth.js";
import type { CloudflareBindingConfig } from "./binding-config-schema.js";
import { CloudflareMcpServerCatalog } from "./mcp-catalog.js";
import type { CloudflareTargetConfig } from "./target-config-schema.js";

export type CloudflareCompileBindingInput = CompileBindingInput<
  CloudflareTargetConfig,
  CloudflareBindingConfig
>;

export function compileCloudflareBinding(
  input: CloudflareCompileBindingInput,
): CompileBindingResult {
  return {
    egressRoutes: compileRemoteMcpServerEgressRoutes({
      catalog: CloudflareMcpServerCatalog,
      selectedIds: input.binding.config.mcpServers,
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver: {
        kind: "integration_connection",
        connectionId: input.connection.id,
        secretType: CloudflareCredentialSecretTypes.API_KEY,
        slotKey: CloudflareCredentialSlotKeys.API_KEY,
      },
    }),
    artifacts: [],
    runtimeClients: [],
  };
}
