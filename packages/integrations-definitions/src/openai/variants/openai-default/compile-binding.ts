import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import type { OpenAiApiKeyBindingConfig } from "./binding-config-schema.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";

export type OpenAiApiKeyCompileBindingInput = CompileBindingInput<
  OpenAiApiKeyTargetConfig,
  OpenAiApiKeyBindingConfig
>;

export function compileOpenAiApiKeyBinding(
  _input: OpenAiApiKeyCompileBindingInput,
): CompileBindingResult {
  return {
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
  };
}
