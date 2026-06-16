import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import {
  AgentMailCredentialSecretTypes,
  AgentMailCredentialSlotKeys,
  AgentMailMcpUrl,
} from "./auth.js";
import { type AgentMailBindingConfig } from "./binding-config-schema.js";
import { AgentMailToolIds } from "./tool-ids.js";

export type AgentMailCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  AgentMailBindingConfig
>;

function createAgentMailMcpRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: ["mcp.agentmail.to"],
      pathPrefixes: ["/mcp"],
    },
    upstream: {
      baseUrl: AgentMailMcpUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: AgentMailCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: AgentMailCredentialSlotKeys.accessToken,
    },
  };
}

export function compileAgentMailBinding(input: AgentMailCompileBindingInput): CompileBindingResult {
  const includesAgentMailMcp = input.binding.config.tools.includes(AgentMailToolIds.AGENTMAIL_MCP);

  return {
    egressRoutes: includesAgentMailMcp
      ? [
          createAgentMailMcpRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: [],
    runtimeClients: [],
  };
}
