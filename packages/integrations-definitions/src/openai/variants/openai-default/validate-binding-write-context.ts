import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import type { BindingWriteValidationResult } from "@mistle/integrations-core";

import type { OpenAiApiKeyBindingConfig } from "./binding-config-schema.js";
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

  if (connectionMethod !== IntegrationConnectionMethodIds.API_KEY) {
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

  const defaultModel = input.binding.config.model.defaultModel;
  const reasoningEffort = input.binding.config.model.options.reasoningEffort;

  if (!input.target.config.bindingCapabilities.models.includes(defaultModel)) {
    return {
      ok: false,
      issues: [
        {
          code: "openai.unsupported_model_for_connection_method",
          field: "config.model.defaultModel",
          safeMessage: `Model '${defaultModel}' is not supported for OpenAI connection method '${connectionMethod}'.`,
        },
      ],
    };
  }

  if (
    !input.target.config.bindingCapabilities.allowedReasoningByModel[defaultModel].includes(
      reasoningEffort,
    )
  ) {
    return {
      ok: false,
      issues: [
        {
          code: "openai.unsupported_reasoning_for_model",
          field: "config.model.options.reasoningEffort",
          safeMessage: `Reasoning effort '${reasoningEffort}' is not supported for model '${defaultModel}' under connection method '${connectionMethod}'.`,
        },
      ],
    };
  }

  return {
    ok: true,
  };
}
