import type {
  BindingWriteValidationContext,
  BindingWriteValidationResult,
} from "@mistle/integrations-core";

import {
  GoogleWorkspaceAnyConnectionConfigSchema,
  GoogleWorkspaceConnectionMethodIds,
} from "./auth.js";
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
  const connectionConfig = GoogleWorkspaceAnyConnectionConfigSchema.parse(input.connection.config);

  if (
    connectionConfig.connection_method !==
    GoogleWorkspaceConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION
  ) {
    return {
      ok: true,
    };
  }

  if (input.binding.config.workspaceUserEmail === undefined) {
    return {
      ok: false,
      issues: [
        {
          code: "google_workspace.missing_workspace_user_email",
          field: "binding.config.workspaceUserEmail",
          safeMessage:
            "Workspace user email is required when a Google Workspace service account connection is bound to a sandbox profile.",
        },
      ],
    };
  }

  return {
    ok: true,
  };
}
