import {
  IntegrationConnectionMethodIds,
  type IntegrationFormContext,
  type ResolvedIntegrationForm,
} from "@mistle/integrations-core";

import { createStackedFieldUiOptions } from "../../../forms/ui-options.js";
import { OpenAiConnectionConfigSchema } from "./auth.js";
import { OpenAiAllowedRuntimeIds } from "./binding-config-schema.js";
import {
  OpenAiReasoningEffortLabelByValue,
  resolveOpenAiCapabilitySetForConnectionMethod,
  type OpenAiModelId,
} from "./model-capabilities.js";
import { OpenAiApiKeyTargetConfigSchema } from "./target-config-schema.js";

type OpenAiBindingFormContext = IntegrationFormContext;

function hasSelectedModelValue(value: unknown): value is { defaultModel: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "defaultModel" in value &&
    typeof value.defaultModel === "string"
  );
}

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
  const modelValue = input.currentValue?.model;
  const currentModel = hasSelectedModelValue(modelValue) ? modelValue.defaultModel : undefined;
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
  const connection = input.connection;
  if (connection === undefined) {
    throw new Error("OpenAI binding form requires connection config context.");
  }

  const parsedTargetConfig = OpenAiApiKeyTargetConfigSchema.parse(target.rawConfig);
  const parsedConnectionConfig = OpenAiConnectionConfigSchema.parse(connection.rawConfig);
  const capabilitySet = resolveOpenAiCapabilitySetForConnectionMethod({
    bindingCapabilitiesByConnectionMethod: parsedTargetConfig.bindingCapabilitiesByConnectionMethod,
    connectionMethod: parsedConnectionConfig.connection_method,
  });
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
          default: {
            runtimeId: OpenAiAllowedRuntimeIds[0],
            config: {},
          },
          properties: {
            runtimeId: {
              const: OpenAiAllowedRuntimeIds[0],
              default: OpenAiAllowedRuntimeIds[0],
            },
            config: {
              default: {},
            },
          },
        },
        model: {
          default: {
            defaultModel: selectedModel,
            options: {
              reasoningEffort: defaultReasoning,
            },
          },
          properties: {
            defaultModel: {
              title: "Default model",
              oneOf: createChoiceList(capabilitySet.models),
              default: selectedModel,
            },
            options: {
              properties: {
                reasoningEffort: {
                  title: "Reasoning effort",
                  oneOf: createChoiceList(reasoningOptions, OpenAiReasoningEffortLabelByValue),
                  default: defaultReasoning,
                },
                additionalInstructions: {
                  title: "Agent Instructions",
                  description: "Appended to the developer message.",
                },
              },
            },
          },
        },
      },
    },
    uiSchema: {
      runtime: {
        runtimeId: {
          "ui:widget": "hidden",
        },
        config: {
          "ui:widget": "hidden",
        },
      },
      model: {
        defaultModel: {
          "ui:widget": "SelectWidget",
          "ui:options": {
            fitContent: true,
          },
        },
        options: {
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
