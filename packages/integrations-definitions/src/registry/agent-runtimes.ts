import { AgentRuntimeRegistry } from "@mistle/integrations-core";

import { CodexRuntimeDefinition } from "../agent-runtimes/codex/index.js";
import { OpenCodeRuntimeDefinition } from "../agent-runtimes/opencode/index.js";
import { PiRuntimeDefinition } from "../agent-runtimes/pi/index.js";

export function createAgentRuntimeRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexRuntimeDefinition);
  registry.register(OpenCodeRuntimeDefinition);
  registry.register(PiRuntimeDefinition);
  return registry;
}
