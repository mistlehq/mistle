import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import {
  DataForSeoCredentialSecretTypes,
  DataForSeoCredentialSlotKeys,
  DataForSeoMcpUrl,
} from "./auth.js";
import type { DataForSeoBindingConfig } from "./binding-config-schema.js";
import { DataForSeoToolIds } from "./tool-ids.js";

export type DataForSeoCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  DataForSeoBindingConfig
>;

function createDataForSeoMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["mcp.dataforseo.com"],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: DataForSeoMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: DataForSeoCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: DataForSeoCredentialSlotKeys.accessToken,
    },
  };
}

export function compileDataForSeoBinding(
  input: DataForSeoCompileBindingInput,
): CompileBindingResult {
  const includesDataForSeoMcp = input.binding.config.tools.includes(
    DataForSeoToolIds.DATAFORSEO_MCP,
  );

  return {
    egressRoutes: includesDataForSeoMcp
      ? [
          createDataForSeoMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
