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

export const OpenAiConnectionMethodIds = {
  API_KEY: "api-key",
} as const;

export type OpenAiConnectionMethodId =
  (typeof OpenAiConnectionMethodIds)[keyof typeof OpenAiConnectionMethodIds];

export type OpenAiCapabilitySet = {
  models: readonly OpenAiModelId[];
  allowedReasoningByModel: Record<OpenAiModelId, readonly OpenAiReasoningEffort[]>;
  defaultReasoningByModel: Record<OpenAiModelId, OpenAiReasoningEffort>;
};

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

export const OpenAiCapabilities: OpenAiCapabilitySet = OpenAiDefaultCapabilitySet;

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

export const OpenAiCapabilitiesSchema = OpenAiCapabilitySetSchema;

OpenAiCapabilitiesSchema.parse(OpenAiCapabilities);

export type OpenAiRawCapabilitySet = {
  models: readonly OpenAiModelId[];
  allowed_reasoning_by_model: Record<OpenAiModelId, readonly OpenAiReasoningEffort[]>;
  default_reasoning_by_model: Record<OpenAiModelId, OpenAiReasoningEffort>;
};

export type OpenAiRawBindingCapabilities = OpenAiRawCapabilitySet;

export function createOpenAiRawBindingCapabilities(): OpenAiRawBindingCapabilities {
  return {
    models: OpenAiCapabilities.models,
    allowed_reasoning_by_model: OpenAiCapabilities.allowedReasoningByModel,
    default_reasoning_by_model: OpenAiCapabilities.defaultReasoningByModel,
  };
}

export function isOpenAiModelSupported(input: {
  model: string;
}): input is { model: OpenAiModelId } {
  return OpenAiCapabilities.models.includes(input.model as OpenAiModelId);
}

export function isOpenAiReasoningEffortSupported(input: {
  model: OpenAiModelId;
  reasoningEffort: string;
}): input is {
  model: OpenAiModelId;
  reasoningEffort: OpenAiReasoningEffort;
} {
  return OpenAiCapabilities.allowedReasoningByModel[input.model].includes(
    input.reasoningEffort as OpenAiReasoningEffort,
  );
}

export function resolveOpenAiDefaultReasoningEffort(input: {
  model: OpenAiModelId;
}): OpenAiReasoningEffort {
  return OpenAiCapabilities.defaultReasoningByModel[input.model];
}
