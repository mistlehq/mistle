import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import { NotionCredentialSecretTypes, NotionCredentialSlotKeys, NotionMcpUrl } from "./auth.js";
import { type NotionBindingConfig } from "./binding-config-schema.js";
import { NotionToolIds } from "./tool-ids.js";

export type NotionCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  NotionBindingConfig
>;

function createNotionMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["mcp.notion.com"],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: NotionMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: NotionCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: NotionCredentialSlotKeys.accessToken,
    },
  };
}

export function compileNotionBinding(input: NotionCompileBindingInput): CompileBindingResult {
  const includesNotionMcp = input.binding.config.tools.includes(NotionToolIds.NOTION_MCP);

  return {
    egressRoutes: includesNotionMcp
      ? [
          createNotionMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
