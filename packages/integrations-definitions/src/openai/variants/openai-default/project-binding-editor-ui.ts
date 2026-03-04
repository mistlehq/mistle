import type {
  BindingEditorVariant,
  IntegrationBindingEditorUiProjection,
} from "../../../ui/binding-editor-ui-contract.js";
import {
  OpenAiConnectionAuthSchemes,
  type OpenAiConnectionAuthScheme,
  type OpenAiModelId,
} from "./model-capabilities.js";
import { projectOpenAiTargetUi } from "./project-target-ui.js";
import type { OpenAiApiKeyTargetConfig } from "./target-config-schema.js";

function createSelectOptions(
  values: readonly OpenAiModelId[],
): readonly { value: string; label: string }[] {
  return values.map((value) => ({
    value,
    label: value,
  }));
}

function resolveFirstModel(
  models: readonly OpenAiModelId[],
  authScheme: OpenAiConnectionAuthScheme,
): OpenAiModelId {
  const firstModel = models[0];
  if (firstModel === undefined) {
    throw new Error(
      `OpenAI binding capabilities must include at least one model for '${authScheme}'.`,
    );
  }
  return firstModel;
}

function createAuthSchemeVariant(input: {
  authScheme: OpenAiConnectionAuthScheme;
  targetConfig: OpenAiApiKeyTargetConfig;
}): BindingEditorVariant {
  const projectedTargetUi = projectOpenAiTargetUi({
    targetConfig: input.targetConfig,
  });
  const capabilitySet = projectedTargetUi.openaiAgent.byAuthScheme[input.authScheme];
  const defaultModel = resolveFirstModel(capabilitySet.models, input.authScheme);
  const modelOptions = createSelectOptions(capabilitySet.models);
  const defaultReasoningEffort = capabilitySet.defaultReasoningByModel[defaultModel];

  if (defaultReasoningEffort === undefined) {
    throw new Error(
      `OpenAI default reasoning effort is missing for model '${defaultModel}' and auth scheme '${input.authScheme}'.`,
    );
  }

  const optionsByModel: Record<string, readonly { value: string; label: string }[]> = {};
  const defaultValueByModel: Record<string, string> = {};

  for (const modelId of capabilitySet.models) {
    const reasoningOptions = capabilitySet.allowedReasoningByModel[modelId];
    if (reasoningOptions === undefined || reasoningOptions.length === 0) {
      throw new Error(
        `OpenAI reasoning options are missing for model '${modelId}' and auth scheme '${input.authScheme}'.`,
      );
    }

    optionsByModel[modelId] = reasoningOptions.map((reasoningEffort) => ({
      value: reasoningEffort,
      label: capabilitySet.reasoningLabels[reasoningEffort],
    }));

    const defaultReasoningForModel = capabilitySet.defaultReasoningByModel[modelId];
    if (defaultReasoningForModel === undefined) {
      throw new Error(
        `OpenAI default reasoning effort is missing for model '${modelId}' and auth scheme '${input.authScheme}'.`,
      );
    }
    defaultValueByModel[modelId] = defaultReasoningForModel;
  }

  const defaultModelReasoningOptions = optionsByModel[defaultModel];
  if (defaultModelReasoningOptions === undefined || defaultModelReasoningOptions.length === 0) {
    throw new Error(
      `OpenAI reasoning options are missing for default model '${defaultModel}' and auth scheme '${input.authScheme}'.`,
    );
  }

  return {
    fields: [
      {
        type: "literal",
        key: "runtime",
        value: projectedTargetUi.openaiAgent.runtime,
      },
      {
        type: "select",
        key: "defaultModel",
        label: "Default model",
        options: modelOptions,
        defaultValue: defaultModel,
      },
      {
        type: "select",
        key: "reasoningEffort",
        label: "Reasoning effort",
        options: defaultModelReasoningOptions,
        defaultValue: defaultReasoningEffort,
        optionsByFieldValue: {
          fieldKey: "defaultModel",
          optionsByValue: optionsByModel,
          defaultValueByValue: defaultValueByModel,
        },
      },
    ],
  };
}

export function projectOpenAiBindingEditorUi(input: {
  targetConfig: OpenAiApiKeyTargetConfig;
}): IntegrationBindingEditorUiProjection {
  const variants: Record<OpenAiConnectionAuthScheme, BindingEditorVariant> = {
    [OpenAiConnectionAuthSchemes.API_KEY]: createAuthSchemeVariant({
      authScheme: OpenAiConnectionAuthSchemes.API_KEY,
      targetConfig: input.targetConfig,
    }),
    [OpenAiConnectionAuthSchemes.OAUTH]: createAuthSchemeVariant({
      authScheme: OpenAiConnectionAuthSchemes.OAUTH,
      targetConfig: input.targetConfig,
    }),
  };

  return {
    bindingEditor: {
      kind: "agent",
      config: {
        mode: "connection-config-key",
        key: "auth_scheme",
        variants,
      },
    },
  };
}
