import type { AgentRuntimeDefinition } from "@mistle/integrations-core";

import { compileClaudeCodeRuntime } from "./compile-runtime.js";
import { ClaudeCodeRuntimeMetadata } from "./metadata.js";
import { ClaudeCodeRuntimeConfigSchema } from "./runtime-config-schema.js";

export const ClaudeCodeRuntimeDefinition: AgentRuntimeDefinition<
  typeof ClaudeCodeRuntimeConfigSchema
> = {
  ...ClaudeCodeRuntimeMetadata,
  compileRuntime: compileClaudeCodeRuntime,
};
