import { type AgentRuntimeDefinition } from "@mistle/integrations-core";

import { compileOpencodeRuntime } from "./compile-runtime.js";
import { OpencodeRuntimeConfigSchema } from "./runtime-config-schema.js";

export const OpencodeRuntimeDefinition: AgentRuntimeDefinition<typeof OpencodeRuntimeConfigSchema> =
  {
    runtimeId: "opencode",
    displayName: "OpenCode",
    logoKey: "opencode",
    configSchema: OpencodeRuntimeConfigSchema,
    compileRuntime: compileOpencodeRuntime,
  };
