import type { BindingWriteValidationResult } from "@mistle/integrations-core";

import type { OpenAiApiKeyBindingConfig } from "./binding-config-schema.js";
import {
  isOpenAiModelSupported,
  isOpenAiReasoningEffortSupported,
  OpenAiConnectionAuthSchemes,
} from "./model-capabilities.js";
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

function readAuthScheme(value: Record<string, unknown>): string | undefined {
  const authScheme = value["auth_scheme"];
  if (typeof authScheme !== "string") {
    return undefined;
  }

  return authScheme;
}

export function validateOpenAiBindingWriteContext(
  input: OpenAiBindingWriteValidationInput,
): BindingWriteValidationResult {
  const authScheme = readAuthScheme(input.connection.config);
  if (authScheme === undefined) {
    return {
      ok: false,
      issues: [
        {
          code: "openai.missing_auth_scheme",
          field: "connection.config.auth_scheme",
          safeMessage:
            "OpenAI connection is missing auth scheme. Reconnect this integration connection.",
        },
      ],
    };
  }

  if (
    authScheme !== OpenAiConnectionAuthSchemes.API_KEY &&
    authScheme !== OpenAiConnectionAuthSchemes.OAUTH
  ) {
    return {
      ok: false,
      issues: [
        {
          code: "openai.unsupported_auth_scheme",
          field: "connection.config.auth_scheme",
          safeMessage: `OpenAI connection auth scheme '${authScheme}' is not supported.`,
        },
      ],
    };
  }

  if (
    !isOpenAiModelSupported({
      authScheme,
      model: input.binding.config.defaultModel,
    })
  ) {
    return {
      ok: false,
      issues: [
        {
          code: "openai.unsupported_model_for_auth_scheme",
          field: "config.defaultModel",
          safeMessage: `Model '${input.binding.config.defaultModel}' is not supported for OpenAI auth scheme '${authScheme}'.`,
        },
      ],
    };
  }

  if (
    !isOpenAiReasoningEffortSupported({
      authScheme,
      model: input.binding.config.defaultModel,
      reasoningEffort: input.binding.config.reasoningEffort,
    })
  ) {
    return {
      ok: false,
      issues: [
        {
          code: "openai.unsupported_reasoning_for_model",
          field: "config.reasoningEffort",
          safeMessage: `Reasoning effort '${input.binding.config.reasoningEffort}' is not supported for model '${input.binding.config.defaultModel}' under auth scheme '${authScheme}'.`,
        },
      ],
    };
  }

  return {
    ok: true,
  };
}
