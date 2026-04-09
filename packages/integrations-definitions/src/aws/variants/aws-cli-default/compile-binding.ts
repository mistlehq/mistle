import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import type { AwsBindingConfig } from "./binding-config-schema.js";
import type { AwsTargetConfig } from "./target-config-schema.js";
import type { AwsTargetSecrets } from "./target-secret-schema.js";

export function compileAwsBinding(
  _input: CompileBindingInput<AwsTargetConfig, AwsBindingConfig, AwsTargetSecrets>,
): CompileBindingResult {
  return {
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
  };
}
