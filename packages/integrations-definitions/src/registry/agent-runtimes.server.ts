import { AgentRuntimeRegistry, type AgentRuntimeDefinition } from "@mistle/integrations-core";

import { createOpenAiConversationProvider } from "../agent-runtimes/codex/conversation-provider.server.js";
import { CodexRuntimeDefinition } from "../agent-runtimes/codex/definition.js";
import { createOpenAiExecutionObserver } from "../agent-runtimes/codex/execution-observer.server.js";
import { createOpencodeConversationProvider } from "../agent-runtimes/opencode/conversation-provider.server.js";
import { OpencodeRuntimeDefinition } from "../agent-runtimes/opencode/definition.js";
import { createOpencodeExecutionObserver } from "../agent-runtimes/opencode/execution-observer.server.js";

const CodexServerRuntimeDefinition: AgentRuntimeDefinition = {
  ...CodexRuntimeDefinition,
  createConversationProvider: createOpenAiConversationProvider,
  createExecutionObserver: createOpenAiExecutionObserver,
};

const OpencodeServerRuntimeDefinition: AgentRuntimeDefinition = {
  ...OpencodeRuntimeDefinition,
  createConversationProvider: createOpencodeConversationProvider,
  createExecutionObserver: createOpencodeExecutionObserver,
};

export function createAgentRuntimeServerRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexServerRuntimeDefinition);
  registry.register(OpencodeServerRuntimeDefinition);
  return registry;
}
