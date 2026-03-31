import { AgentRuntimeRegistry, type AgentRuntimeDefinition } from "@mistle/integrations-core";

import { createOpenAiConversationProvider } from "../agent-runtimes/codex/conversation-provider.server.js";
import { CodexRuntimeDefinition } from "../agent-runtimes/codex/definition.js";
import { createOpenAiExecutionObserver } from "../agent-runtimes/codex/execution-observer.server.js";

const CodexServerRuntimeDefinition: AgentRuntimeDefinition = {
  ...CodexRuntimeDefinition,
  createConversationProvider: createOpenAiConversationProvider,
  createExecutionObserver: createOpenAiExecutionObserver,
};

export function createAgentRuntimeServerRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexServerRuntimeDefinition);
  return registry;
}
