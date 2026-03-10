import type { IntegrationFormContext, ResolvedIntegrationForm } from "@mistle/integrations-core";

import { OpenAiConnectionConfigSchema } from "./auth.js";
import { OpenAiRuntimes } from "./binding-config-schema.js";
import { OpenAiConnectionAuthSchemes } from "./model-capabilities.js";
import {
  OpenAiReasoningEffortLabelByValue,
  type OpenAiConnectionAuthScheme,
  type OpenAiModelId,
} from "./model-capabilities.js";
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

function resolveAuthScheme(input: OpenAiBindingFormContext): OpenAiConnectionAuthScheme {
  const connection = input.connection;
  if (connection === undefined) {
    throw new Error("OpenAI binding form requires connection config context.");
  }

  const parsedConnectionConfig = OpenAiConnectionConfigSchema.parse(connection.rawConfig);
  const authScheme = parsedConnectionConfig.auth_scheme;
  if (
    authScheme !== OpenAiConnectionAuthSchemes.API_KEY &&
    authScheme !== OpenAiConnectionAuthSchemes.OAUTH
  ) {
    throw new Error("OpenAI binding form requires a valid connection auth_scheme.");
  }

  return authScheme;
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
  const authScheme = resolveAuthScheme(input);
  const capabilitySet = parsedTargetConfig.bindingCapabilities.byAuthScheme[authScheme];
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
        "ui:options": {
          rows: 8,
        },
      },
    },
  };
}

export const OpenAiConnectionConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      auth_scheme: {
        title: "Authentication method",
        oneOf: createChoiceList([
          OpenAiConnectionAuthSchemes.API_KEY,
          OpenAiConnectionAuthSchemes.OAUTH,
        ]),
        default: OpenAiConnectionAuthSchemes.API_KEY,
      },
    },
  },
  uiSchema: {
    auth_scheme: {
      "ui:widget": "SelectWidget",
    },
  },
};
