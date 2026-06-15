import { AgentRuntimeRegistry, type AnyAgentRuntimeMetadata } from "@mistle/integrations-core";

import { ClaudeCodeRuntimeMetadata } from "../agent-runtimes/claude-code/metadata.js";
import { CodexRuntimeMetadata } from "../agent-runtimes/codex/metadata.js";
import { OpenCodeRuntimeMetadata } from "../agent-runtimes/opencode/metadata.js";
import { PiRuntimeMetadata } from "../agent-runtimes/pi/metadata.js";

export function createAgentRuntimeRegistry(): AgentRuntimeRegistry<AnyAgentRuntimeMetadata> {
  // This registry is consumed by browser bundles. Keep imports pinned to
  // metadata modules so compile-only runtime code stays out of browser transforms.
  const registry = new AgentRuntimeRegistry<AnyAgentRuntimeMetadata>();
  registry.register(CodexRuntimeMetadata);
  registry.register(ClaudeCodeRuntimeMetadata);
  registry.register(OpenCodeRuntimeMetadata);
  registry.register(PiRuntimeMetadata);
  return registry;
}
