import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import { RailwayCredentialSecretTypes, RailwayCredentialSlotKeys, RailwayMcpUrl } from "./auth.js";
import type { RailwayBindingConfig } from "./binding-config-schema.js";
import { RailwayToolIds } from "./tool-ids.js";

export type RailwayCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  RailwayBindingConfig
>;

function createRailwayMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  const upstreamUrl = new URL(RailwayMcpUrl);

  return {
    match: {
      hosts: [upstreamUrl.host],
      pathPrefixes: [upstreamUrl.pathname],
    },
    upstream: {
      baseUrl: upstreamUrl.toString(),
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: RailwayCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: RailwayCredentialSlotKeys.accessToken,
    },
  };
}

export function compileRailwayBinding(input: RailwayCompileBindingInput): CompileBindingResult {
  const includesRailwayMcp = input.binding.config.tools.includes(RailwayToolIds.RAILWAY_MCP);

  return {
    egressRoutes: includesRailwayMcp
      ? [
          createRailwayMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
