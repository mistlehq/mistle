import {
  IntegrationConnectionMethodIds,
  type IntegrationFormContext,
  type ResolvedIntegrationForm,
} from "@mistle/integrations-core";

import { createStackedFieldUiOptions } from "../../../forms/ui-options.js";
import { OpenAiRuntimes } from "./binding-config-schema.js";
import { OpenAiReasoningEffortLabelByValue, type OpenAiModelId } from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

type OpenAiBindingFormContext = IntegrationFormContext;

function createChoiceList(
  values: readonly string[],
  labelByValue?: Readonly<Record<string, string>>,
): ReadonlyArray<Record<string, unknown>> {
  return values.map((value) => ({
    const: value,
    title: labelByValue?.[value] ?? value,
  }));
}

function resolveSelectedModel(input: {
  models: readonly OpenAiModelId[];
  currentValue: Record<string, unknown> | undefined;
}): OpenAiModelId {
  const currentModel = input.currentValue?.defaultModel;
  if (typeof currentModel === "string") {
    const matchingModel = input.models.find((model) => model === currentModel);
    if (matchingModel !== undefined) {
      return matchingModel;
    }
  }

  const defaultModel = input.models[0];
  if (defaultModel === undefined) {
    throw new Error("OpenAI binding form requires at least one supported model.");
  }

  return defaultModel;
}

export function resolveOpenAiBindingConfigForm(
  input: OpenAiBindingFormContext,
): ResolvedIntegrationForm {
  const target = input.target;
  if (target === undefined) {
    throw new Error("OpenAI binding form requires target config context.");
  }

  const parsedTargetConfig = OpenAiApiKeyTargetConfigSchema.parse(target.rawConfig);
  const capabilitySet = parsedTargetConfig.bindingCapabilities;
  const selectedModel = resolveSelectedModel({
    models: capabilitySet.models,
    currentValue: input.currentValue,
  });
  const reasoningOptions = capabilitySet.allowedReasoningByModel[selectedModel];
  if (reasoningOptions === undefined || reasoningOptions.length === 0) {
    throw new Error(
      `OpenAI binding form is missing reasoning options for model '${selectedModel}'.`,
    );
  }

  const defaultReasoning = capabilitySet.defaultReasoningByModel[selectedModel];
  if (defaultReasoning === undefined) {
    throw new Error(
      `OpenAI binding form is missing default reasoning for model '${selectedModel}'.`,
    );
  }

  return {
    schema: {
      properties: {
        runtime: {
          default: OpenAiRuntimes.CODEX_CLI,
        },
        defaultModel: {
          title: "Default model",
          oneOf: createChoiceList(capabilitySet.models),
          default: selectedModel,
        },
        reasoningEffort: {
          title: "Reasoning effort",
          oneOf: createChoiceList(reasoningOptions, OpenAiReasoningEffortLabelByValue),
          default: defaultReasoning,
        },
        additionalInstructions: {
          title: "Additional instructions",
          description: "Added to the runtime's built-in agent instructions.",
        },
      },
    },
    uiSchema: {
      runtime: {
        "ui:widget": "hidden",
      },
      defaultModel: {
        "ui:widget": "SelectWidget",
        "ui:options": {
          fitContent: true,
        },
      },
      reasoningEffort: {
        "ui:widget": "SelectWidget",
      },
      additionalInstructions: {
        "ui:widget": "TextareaWidget",
        "ui:options": createStackedFieldUiOptions({
          rows: 8,
        }),
      },
    },
  };
}

export const OpenAiConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      connection_method: {
        default: IntegrationConnectionMethodIds.API_KEY,
      },
    },
  },
  uiSchema: {
    connection_method: {
      "ui:widget": "hidden",
    },
  },
};
