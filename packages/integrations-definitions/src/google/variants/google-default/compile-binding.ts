import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import type { GoogleBindingConfig } from "./binding-config-schema.js";
import type { GoogleTargetConfig } from "./target-config-schema.js";
import type { GoogleTargetSecrets } from "./target-secret-schema.js";

export function compileGoogleBinding(
  _input: CompileBindingInput<GoogleTargetConfig, GoogleBindingConfig, GoogleTargetSecrets>,
): CompileBindingResult {
  return {
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
  };
}
