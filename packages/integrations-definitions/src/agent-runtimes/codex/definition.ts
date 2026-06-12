import type { AgentRuntimeDefinition } from "@mistle/integrations-core";

import { compileCodexRuntime } from "./compile-runtime.js";
import { CodexRuntimeMetadata } from "./metadata.js";
import { CodexRuntimeConfigSchema } from "./runtime-config-schema.js";

export const CodexRuntimeDefinition: AgentRuntimeDefinition<typeof CodexRuntimeConfigSchema> = {
  ...CodexRuntimeMetadata,
  compileRuntime: compileCodexRuntime,
};
