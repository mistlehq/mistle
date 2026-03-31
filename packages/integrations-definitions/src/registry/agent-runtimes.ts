import { AgentRuntimeRegistry } from "@mistle/integrations-core";

import { CodexRuntimeDefinition } from "../agent-runtimes/codex/index.js";
import { OpencodeRuntimeDefinition } from "../agent-runtimes/opencode/index.js";

export function createAgentRuntimeRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexRuntimeDefinition);
  registry.register(OpencodeRuntimeDefinition);
  return registry;
}
