import type { AgentRuntimeDefinition } from "@mistle/integrations-core";

import { compilePiRuntime } from "./compile-runtime.js";
import { PiRuntimeConfigSchema } from "./runtime-config-schema.js";

export const PiRuntimeDefinition: AgentRuntimeDefinition<typeof PiRuntimeConfigSchema> = {
  runtimeId: "pi",
  displayName: "Pi",
  logoKey: "pi",
  configSchema: PiRuntimeConfigSchema,
  compileRuntime: compilePiRuntime,
};
