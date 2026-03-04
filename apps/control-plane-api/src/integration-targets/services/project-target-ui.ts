import {
  createIntegrationRegistry,
  OpenAiApiKeyTargetConfigSchema,
  OpenAiReasoningEffortLabelByValue,
} from "@mistle/integrations-definitions";

const IntegrationRegistry = createIntegrationRegistry();

export type ProjectedTargetHealth = {
  configStatus: "valid" | "invalid";
};

export type ProjectedOpenAiBindingUi = {
  kind: "agent";
  runtime: "codex-cli";
  familyId: "openai";
  variantId: "openai-default";
  byAuthScheme: Record<
    "api-key" | "oauth",
    {
      models: string[];
      allowedReasoningByModel: Record<string, ("low" | "medium" | "high" | "xhigh")[]>;
      defaultReasoningByModel: Record<string, "low" | "medium" | "high" | "xhigh">;
      reasoningLabels: Record<"low" | "medium" | "high" | "xhigh", string>;
    }
  >;
};

export type ProjectedBindingUi = {
  openaiAgent?: ProjectedOpenAiBindingUi;
};

export function projectTargetUi(input: {
  familyId: string;
  variantId: string;
  config: Record<string, unknown>;
}): {
  targetHealth: ProjectedTargetHealth;
  resolvedBindingUi?: ProjectedBindingUi;
} {
  const definition = IntegrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });
  if (definition === undefined) {
    return {
      targetHealth: {
        configStatus: "valid",
      },
    };
  }

  try {
    definition.targetConfigSchema.parse(input.config);

    if (
      input.familyId === "openai" &&
      input.variantId === "openai-default" &&
      definition.kind === "agent"
    ) {
      const openAiConfig = OpenAiApiKeyTargetConfigSchema.parse(input.config);

      return {
        targetHealth: {
          configStatus: "valid",
        },
        resolvedBindingUi: {
          openaiAgent: {
            kind: "agent",
            runtime: "codex-cli",
            familyId: "openai",
            variantId: "openai-default",
            byAuthScheme: {
              "api-key": {
                models: openAiConfig.bindingCapabilities.byAuthScheme["api-key"].models,
                allowedReasoningByModel:
                  openAiConfig.bindingCapabilities.byAuthScheme["api-key"].allowedReasoningByModel,
                defaultReasoningByModel:
                  openAiConfig.bindingCapabilities.byAuthScheme["api-key"].defaultReasoningByModel,
                reasoningLabels: OpenAiReasoningEffortLabelByValue,
              },
              oauth: {
                models: openAiConfig.bindingCapabilities.byAuthScheme.oauth.models,
                allowedReasoningByModel:
                  openAiConfig.bindingCapabilities.byAuthScheme.oauth.allowedReasoningByModel,
                defaultReasoningByModel:
                  openAiConfig.bindingCapabilities.byAuthScheme.oauth.defaultReasoningByModel,
                reasoningLabels: OpenAiReasoningEffortLabelByValue,
              },
            },
          },
        },
      };
    }

    return {
      targetHealth: {
        configStatus: "valid",
      },
    };
  } catch {
    return {
      targetHealth: {
        configStatus: "invalid",
      },
    };
  }
}
