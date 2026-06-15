import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { BugSnagCredentialSecretTypes, BugSnagCredentialSlotKeys, BugSnagMcpUrl } from "./auth.js";
import { type BugSnagBindingConfig } from "./binding-config-schema.js";
import { BugSnagToolIds } from "./tool-ids.js";

export type BugSnagCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  BugSnagBindingConfig
>;

function createBugSnagMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["bugsnag.mcp.smartbear.com"],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: BugSnagMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: BugSnagCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: BugSnagCredentialSlotKeys.accessToken,
    },
  };
}

export function compileBugSnagBinding(input: BugSnagCompileBindingInput): CompileBindingResult {
  const includesBugSnagMcp = input.binding.config.tools.includes(BugSnagToolIds.BUGSNAG_MCP);

  return {
    egressRoutes: includesBugSnagMcp
      ? [
          createBugSnagMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
