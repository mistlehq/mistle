import { AgentRuntimeRegistry, type AnyAgentRuntimeMetadata } from "@mistle/integrations-core";

import { AgentRuntimeMetadataCatalog } from "../agent-runtimes/catalog.js";

export function createAgentRuntimeRegistry(): AgentRuntimeRegistry<AnyAgentRuntimeMetadata> {
  // This registry is consumed by browser bundles. Keep imports pinned to
  // metadata modules so compile-only runtime code stays out of browser transforms.
  const registry = new AgentRuntimeRegistry<AnyAgentRuntimeMetadata>();
  registry.registerMany(AgentRuntimeMetadataCatalog);
  return registry;
}
