import {
  OpenAiReasoningEffortLabelByValue,
  type OpenAiCapabilitiesByAuthScheme,
} from "./model-capabilities.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";
import type { OpenAiTargetUiProjection } from "./ui-contract.js";

function mapAuthSchemeCapabilitiesToUiProjection(
  byAuthScheme: OpenAiCapabilitiesByAuthScheme,
): OpenAiTargetUiProjection["openaiAgent"]["byAuthScheme"] {
  return {
    "api-key": {
      models: byAuthScheme["api-key"].models,
      allowedReasoningByModel: byAuthScheme["api-key"].allowedReasoningByModel,
      defaultReasoningByModel: byAuthScheme["api-key"].defaultReasoningByModel,
      reasoningLabels: OpenAiReasoningEffortLabelByValue,
    },
    oauth: {
      models: byAuthScheme.oauth.models,
      allowedReasoningByModel: byAuthScheme.oauth.allowedReasoningByModel,
      defaultReasoningByModel: byAuthScheme.oauth.defaultReasoningByModel,
      reasoningLabels: OpenAiReasoningEffortLabelByValue,
    },
  };
}

export function projectOpenAiTargetUi(input: {
  targetConfig: OpenAiApiKeyTargetConfig;
}): OpenAiTargetUiProjection {
  return {
    openaiAgent: {
      kind: "agent",
      runtime: "codex-cli",
      familyId: "openai",
      variantId: "openai-default",
      byAuthScheme: mapAuthSchemeCapabilitiesToUiProjection(
        input.targetConfig.bindingCapabilities.byAuthScheme,
      ),
    },
  };
}
