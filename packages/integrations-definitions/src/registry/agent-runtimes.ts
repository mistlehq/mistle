import { AgentRuntimeRegistry } from "@mistle/integrations-core";

import { CodexRuntimeDefinition } from "../agent-runtimes/codex/index.js";
import { OpenCodeRuntimeDefinition } from "../agent-runtimes/opencode/index.js";

export function createAgentRuntimeRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexRuntimeDefinition);
  registry.register(OpenCodeRuntimeDefinition);
  return registry;
}
