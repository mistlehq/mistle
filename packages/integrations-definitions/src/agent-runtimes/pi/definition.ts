import type { AgentRuntimeDefinition } from "@mistle/integrations-core";

import { compilePiRuntime } from "./compile-runtime.js";
import { PiRuntimeMetadata } from "./metadata.js";
import { PiRuntimeConfigSchema } from "./runtime-config-schema.js";

export const PiRuntimeDefinition: AgentRuntimeDefinition<typeof PiRuntimeConfigSchema> = {
  ...PiRuntimeMetadata,
  compileRuntime: compilePiRuntime,
};
