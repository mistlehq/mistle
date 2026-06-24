import type {
  BindingWriteValidationContext,
  BindingWriteValidationResult,
} from "@mistle/integrations-core";

import { GoogleWorkspaceAnyConnectionConfigSchema } from "./auth.js";
import type { GoogleWorkspaceBindingConfig } from "./binding-config-schema.js";
import type { GoogleWorkspaceTargetConfig } from "./target-config-schema.js";

type GoogleWorkspaceBindingWriteValidationInput = BindingWriteValidationContext<
  GoogleWorkspaceTargetConfig,
  GoogleWorkspaceBindingConfig,
  Record<string, unknown>
>;

export function validateGoogleWorkspaceBindingWriteContext(
  input: GoogleWorkspaceBindingWriteValidationInput,
): BindingWriteValidationResult {
  GoogleWorkspaceAnyConnectionConfigSchema.parse(input.connection.config);

  return {
    ok: true,
  };
}
