import type { AgentRuntimeDefinition } from "@mistle/integrations-core";

import { compileOpenCodeRuntime } from "./compile-runtime.js";
import { OpenCodeRuntimeMetadata } from "./metadata.js";
import { OpenCodeRuntimeConfigSchema } from "./runtime-config-schema.js";

export const OpenCodeRuntimeDefinition: AgentRuntimeDefinition<typeof OpenCodeRuntimeConfigSchema> =
  {
    ...OpenCodeRuntimeMetadata,
    compileRuntime: compileOpenCodeRuntime,
  };
