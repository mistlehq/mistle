import { AgentRuntimeRegistry, type AgentRuntimeDefinition } from "@mistle/integrations-core";

import { createOpenAiConversationProvider } from "../agent-runtimes/codex/conversation-provider.server.js";
import { CodexRuntimeDefinition } from "../agent-runtimes/codex/definition.js";
import { createOpenCodeConversationProvider } from "../agent-runtimes/opencode/conversation-provider.server.js";
import { OpenCodeRuntimeDefinition } from "../agent-runtimes/opencode/definition.js";
import { createPiConversationProvider } from "../agent-runtimes/pi/conversation-provider.server.js";
import { PiRuntimeDefinition } from "../agent-runtimes/pi/definition.js";

const CodexServerRuntimeDefinition: AgentRuntimeDefinition = {
  ...CodexRuntimeDefinition,
  createConversationProvider: createOpenAiConversationProvider,
};

const OpenCodeServerRuntimeDefinition: AgentRuntimeDefinition = {
  ...OpenCodeRuntimeDefinition,
  createConversationProvider: createOpenCodeConversationProvider,
};

const PiServerRuntimeDefinition: AgentRuntimeDefinition = {
  ...PiRuntimeDefinition,
  createConversationProvider: createPiConversationProvider,
};

export function createAgentRuntimeServerRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexServerRuntimeDefinition);
  registry.register(OpenCodeServerRuntimeDefinition);
  registry.register(PiServerRuntimeDefinition);
  return registry;
}
