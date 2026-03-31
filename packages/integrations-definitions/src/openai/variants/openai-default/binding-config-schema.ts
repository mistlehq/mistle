import { z } from "zod";

import { OpenAiModelIds, OpenAiReasoningEfforts } from "./model-capabilities.js";
export { OpenAiReasoningEfforts } from "./model-capabilities.js";

export const OpenAiAllowedRuntimeIds = ["codex"] as const;

const OpenAiAdditionalInstructionsSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().length === 0 ? undefined : value;
}, z.string().optional());

export const OpenAiApiKeyBindingConfigSchema = z
  .object({
    runtime: z
      .object({
        runtimeId: z.enum(OpenAiAllowedRuntimeIds),
        config: z.record(z.string(), z.unknown()),
      })
      .strict(),
    model: z
      .object({
        defaultModel: z.enum(OpenAiModelIds),
        options: z
          .object({
            reasoningEffort: z.enum([
              OpenAiReasoningEfforts.LOW,
              OpenAiReasoningEfforts.MEDIUM,
              OpenAiReasoningEfforts.HIGH,
              OpenAiReasoningEfforts.XHIGH,
            ]),
            additionalInstructions: OpenAiAdditionalInstructionsSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type OpenAiApiKeyBindingConfig = z.output<typeof OpenAiApiKeyBindingConfigSchema>;
