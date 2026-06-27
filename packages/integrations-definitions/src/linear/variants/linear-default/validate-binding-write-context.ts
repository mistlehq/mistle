import type {
  BindingWriteValidationContext,
  BindingWriteValidationResult,
} from "@mistle/integrations-core";

import {
  LinearConnectionConfigSchema,
  LinearConnectionMethodIds,
  type LinearConnectionConfig,
} from "./auth.js";
import type { LinearBindingConfig } from "./binding-config-schema.js";
import type { LinearTargetConfig } from "./target-config-schema.js";

type LinearBindingWriteValidationInput = BindingWriteValidationContext<
  LinearTargetConfig,
  LinearBindingConfig,
  LinearConnectionConfig
>;

export function validateLinearBindingWriteContext(
  input: LinearBindingWriteValidationInput,
): BindingWriteValidationResult {
  const connectionConfig = LinearConnectionConfigSchema.parse(input.connection.config);

  if (connectionConfig.connection_method === LinearConnectionMethodIds.OAUTH_APP) {
    return {
      ok: false,
      issues: [
        {
          code: "linear.setup_only_connection_method",
          field: "connection.config.connection_method",
          safeMessage:
            "Linear OAuth app connections are setup-only for identity linking and cannot be used in Linear connector bindings.",
        },
      ],
    };
  }

  return {
    ok: true,
  };
}
