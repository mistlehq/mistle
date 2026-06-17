import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import {
  SupabaseCredentialSecretTypes,
  SupabaseCredentialSlotKeys,
  SupabaseMcpUrl,
} from "./auth.js";
import { type SupabaseBindingConfig } from "./binding-config-schema.js";
import { SupabaseToolIds } from "./tool-ids.js";

export type SupabaseCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  SupabaseBindingConfig
>;

function createSupabaseMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["mcp.supabase.com"],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: SupabaseMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: SupabaseCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: SupabaseCredentialSlotKeys.accessToken,
    },
  };
}

export function compileSupabaseBinding(input: SupabaseCompileBindingInput): CompileBindingResult {
  const includesSupabaseMcp = input.binding.config.tools.includes(SupabaseToolIds.SUPABASE_MCP);

  return {
    egressRoutes: includesSupabaseMcp
      ? [
          createSupabaseMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
