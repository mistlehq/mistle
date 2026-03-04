import { z } from "zod";

export const OpenAiReasoningEfforts = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
} as const;

export type OpenAiReasoningEffort =
  (typeof OpenAiReasoningEfforts)[keyof typeof OpenAiReasoningEfforts];

export const OpenAiReasoningEffortLabelByValue: Record<OpenAiReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

export const OpenAiModelIds = [
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.1-codex-mini",
] as const;

export type OpenAiModelId = (typeof OpenAiModelIds)[number];

export const OpenAiConnectionAuthSchemes = {
  API_KEY: "api-key",
  OAUTH: "oauth",
} as const;

export type OpenAiConnectionAuthScheme =
  (typeof OpenAiConnectionAuthSchemes)[keyof typeof OpenAiConnectionAuthSchemes];

type OpenAiCapabilitySet = {
  models: readonly OpenAiModelId[];
  allowedReasoningByModel: Record<OpenAiModelId, readonly OpenAiReasoningEffort[]>;
  defaultReasoningByModel: Record<OpenAiModelId, OpenAiReasoningEffort>;
};

export type OpenAiCapabilitiesByAuthScheme = Record<
  OpenAiConnectionAuthScheme,
  OpenAiCapabilitySet
>;

const OpenAiDefaultCapabilitySet: OpenAiCapabilitySet = {
  models: OpenAiModelIds,
  allowedReasoningByModel: {
    "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
    "gpt-5.3-codex-spark": ["low", "medium", "high", "xhigh"],
    "gpt-5.2-codex": ["low", "medium", "high", "xhigh"],
    "gpt-5.1-codex-max": ["low", "medium", "high", "xhigh"],
    "gpt-5.2": ["low", "medium", "high", "xhigh"],
    "gpt-5.1-codex-mini": ["medium", "high"],
  },
  defaultReasoningByModel: {
    "gpt-5.3-codex": "medium",
    "gpt-5.3-codex-spark": "high",
    "gpt-5.2-codex": "medium",
    "gpt-5.1-codex-max": "medium",
    "gpt-5.2": "medium",
    "gpt-5.1-codex-mini": "medium",
  },
};

export const OpenAiCapabilitiesByAuthScheme: OpenAiCapabilitiesByAuthScheme = {
  "api-key": OpenAiDefaultCapabilitySet,
  oauth: OpenAiDefaultCapabilitySet,
};

const OpenAiReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);
const OpenAiModelIdSchema = z.enum(OpenAiModelIds);

const OpenAiCapabilitySetSchema = z
  .object({
    models: z.array(OpenAiModelIdSchema).min(1),
    allowedReasoningByModel: z.record(
      OpenAiModelIdSchema,
      z.array(OpenAiReasoningEffortSchema).min(1),
    ),
    defaultReasoningByModel: z.record(OpenAiModelIdSchema, OpenAiReasoningEffortSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const model of value.models) {
      const allowed = value.allowedReasoningByModel[model];
      const defaultReasoning = value.defaultReasoningByModel[model];
      if (allowed === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `Missing allowed reasoning values for model '${model}'.`,
          path: ["allowedReasoningByModel", model],
        });
        continue;
      }
      if (defaultReasoning === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `Missing default reasoning value for model '${model}'.`,
          path: ["defaultReasoningByModel", model],
        });
        continue;
      }
      if (!allowed.includes(defaultReasoning)) {
        ctx.addIssue({
          code: "custom",
          message: `Default reasoning '${defaultReasoning}' is not allowed for model '${model}'.`,
          path: ["defaultReasoningByModel", model],
        });
      }
    }
  });

export const OpenAiCapabilitiesByAuthSchemeSchema = z
  .object({
    "api-key": OpenAiCapabilitySetSchema,
    oauth: OpenAiCapabilitySetSchema,
  })
  .strict();

OpenAiCapabilitiesByAuthSchemeSchema.parse(OpenAiCapabilitiesByAuthScheme);

export type OpenAiRawCapabilitySet = {
  models: readonly OpenAiModelId[];
  allowed_reasoning_by_model: Record<OpenAiModelId, readonly OpenAiReasoningEffort[]>;
  default_reasoning_by_model: Record<OpenAiModelId, OpenAiReasoningEffort>;
};

export type OpenAiRawBindingCapabilities = {
  by_auth_scheme: Record<OpenAiConnectionAuthScheme, OpenAiRawCapabilitySet>;
};

export function createOpenAiRawBindingCapabilities(): OpenAiRawBindingCapabilities {
  const byAuthScheme: Record<OpenAiConnectionAuthScheme, OpenAiRawCapabilitySet> = {
    "api-key": {
      models: OpenAiCapabilitiesByAuthScheme["api-key"].models,
      allowed_reasoning_by_model: OpenAiCapabilitiesByAuthScheme["api-key"].allowedReasoningByModel,
      default_reasoning_by_model: OpenAiCapabilitiesByAuthScheme["api-key"].defaultReasoningByModel,
    },
    oauth: {
      models: OpenAiCapabilitiesByAuthScheme.oauth.models,
      allowed_reasoning_by_model: OpenAiCapabilitiesByAuthScheme.oauth.allowedReasoningByModel,
      default_reasoning_by_model: OpenAiCapabilitiesByAuthScheme.oauth.defaultReasoningByModel,
    },
  };

  return {
    by_auth_scheme: byAuthScheme,
  };
}

export function isOpenAiModelSupported(input: {
  authScheme: OpenAiConnectionAuthScheme;
  model: string;
}): input is { authScheme: OpenAiConnectionAuthScheme; model: OpenAiModelId } {
  return OpenAiCapabilitiesByAuthScheme[input.authScheme].models.includes(
    input.model as OpenAiModelId,
  );
}

export function isOpenAiReasoningEffortSupported(input: {
  authScheme: OpenAiConnectionAuthScheme;
  model: OpenAiModelId;
  reasoningEffort: string;
}): input is {
  authScheme: OpenAiConnectionAuthScheme;
  model: OpenAiModelId;
  reasoningEffort: OpenAiReasoningEffort;
} {
  return OpenAiCapabilitiesByAuthScheme[input.authScheme].allowedReasoningByModel[
    input.model
  ].includes(input.reasoningEffort as OpenAiReasoningEffort);
}

export function resolveOpenAiDefaultReasoningEffort(input: {
  authScheme: OpenAiConnectionAuthScheme;
  model: OpenAiModelId;
}): OpenAiReasoningEffort {
  return OpenAiCapabilitiesByAuthScheme[input.authScheme].defaultReasoningByModel[input.model];
}
