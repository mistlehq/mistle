import type { BindingWriteValidationResult } from "@mistle/integrations-core";

import { OpenAiConnectionConfigSchema } from "./auth.js";
import type { OpenAiApiKeyBindingConfig } from "./binding-config-schema.js";
import { isOpenAiConnectionMethodId } from "./model-capabilities.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";

type OpenAiBindingWriteValidationInput = {
  targetKey: string;
  bindingIdOrDraftIndex: string;
  target: {
    familyId: string;
    variantId: string;
    config: OpenAiApiKeyTargetConfig;
  };
  connection: {
    id: string;
    config: Record<string, unknown>;
  };
  binding: {
    kind: string;
    config: OpenAiApiKeyBindingConfig;
  };
};

function readConnectionMethod(value: Record<string, unknown>): string | undefined {
  const connectionMethod = value["connection_method"];
  if (typeof connectionMethod !== "string") {
    return undefined;
  }

  return connectionMethod;
}

export function validateOpenAiBindingWriteContext(
  input: OpenAiBindingWriteValidationInput,
): BindingWriteValidationResult {
  const connectionMethod = readConnectionMethod(input.connection.config);
  if (connectionMethod === undefined) {
    return {
      ok: false,
      issues: [
        {
          code: "openai.missing_connection_method",
          field: "connection.config.connection_method",
          safeMessage:
            "OpenAI connection is missing connection method. Reconnect this integration connection.",
        },
      ],
    };
  }

  if (!isOpenAiConnectionMethodId(connectionMethod)) {
    return {
      ok: false,
      issues: [
        {
          code: "openai.unsupported_connection_method",
          field: "connection.config.connection_method",
          safeMessage: `OpenAI connection method '${connectionMethod}' is not supported.`,
        },
      ],
    };
  }

  OpenAiConnectionConfigSchema.parse(input.connection.config);

  return {
    ok: true,
  };
}
