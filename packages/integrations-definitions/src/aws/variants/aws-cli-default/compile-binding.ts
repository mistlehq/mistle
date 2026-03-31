import type { CompileBindingResult } from "@mistle/integrations-core";

const EmptyCompileBindingResult: CompileBindingResult = {
  egressRoutes: [],
  artifacts: [],
  runtimeClients: [],
};

export function compileAwsCliDefaultBinding(): CompileBindingResult {
  return EmptyCompileBindingResult;
}
