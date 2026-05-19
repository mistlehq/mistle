import { AgentRuntimeRegistry } from "@mistle/integrations-core";

import { CodexRuntimeDefinition } from "../agent-runtimes/codex/definition.js";
import { OpenCodeRuntimeDefinition } from "../agent-runtimes/opencode/definition.js";
import { PiRuntimeDefinition } from "../agent-runtimes/pi/definition.js";

export function createAgentRuntimeRegistry(): AgentRuntimeRegistry {
  // This registry is consumed by browser bundles. Keep imports pinned to
  // definition modules so runtime barrels can expose server-only helpers.
  const registry = new AgentRuntimeRegistry();
  registry.register(CodexRuntimeDefinition);
  registry.register(OpenCodeRuntimeDefinition);
  registry.register(PiRuntimeDefinition);
  return registry;
}
