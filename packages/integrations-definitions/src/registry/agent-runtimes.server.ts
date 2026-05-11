import { AgentRuntimeRegistry, type AgentRuntimeDefinition } from "@mistle/integrations-core";

import { createOpenAiConversationProvider } from "../agent-runtimes/codex/conversation-provider.server.js";
import { CodexRuntimeDefinition } from "../agent-runtimes/codex/definition.js";
import { OpenCodeRuntimeDefinition } from "../agent-runtimes/opencode/definition.js";

const CodexServerRuntimeDefinition: AgentRuntimeDefinition = {
  ...CodexRuntimeDefinition,
  createConversationProvider: createOpenAiConversationProvider,
};

export function createAgentRuntimeServerRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexServerRuntimeDefinition);
  registry.register(OpenCodeRuntimeDefinition);
  return registry;
}
