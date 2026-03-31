import { AgentRuntimeRegistry } from "@mistle/integrations-core";

import { CodexRuntimeDefinition } from "../agent-runtimes/codex/index.js";

export function createAgentRuntimeRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexRuntimeDefinition);
  return registry;
}
