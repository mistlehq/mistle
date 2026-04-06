import type { AgentConversationProvider } from "@mistle/integrations-core";

import { createAgentRuntimeServerRegistry } from "../registry/agent-runtimes.server.js";

const AgentRuntimeRegistry = createAgentRuntimeServerRegistry();

export function resolveAgentConversationProvider(runtimeId: string): AgentConversationProvider {
  const runtimeDefinition = AgentRuntimeRegistry.getRuntimeOrThrow({
    runtimeId,
  });

  if (runtimeDefinition.createConversationProvider === undefined) {
    throw new Error(`Agent runtime '${runtimeId}' does not define createConversationProvider().`);
  }

  return runtimeDefinition.createConversationProvider();
}
