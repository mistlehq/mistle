import { z } from "zod";

import { OpenAiModelIds, OpenAiReasoningEfforts } from "./model-capabilities.js";
export { OpenAiReasoningEfforts } from "./model-capabilities.js";

export const OpenAiRuntimes: {
  CODEX_CLI: "codex-cli";
} = {
  CODEX_CLI: "codex-cli",
};

const OpenAiAdditionalInstructionsSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().length === 0 ? undefined : value;
}, z.string().optional());

export const OpenAiApiKeyBindingConfigSchema = z
  .object({
    runtime: z.literal(OpenAiRuntimes.CODEX_CLI),
    defaultModel: z.enum(OpenAiModelIds),
    reasoningEffort: z.enum([
      OpenAiReasoningEfforts.LOW,
      OpenAiReasoningEfforts.MEDIUM,
      OpenAiReasoningEfforts.HIGH,
      OpenAiReasoningEfforts.XHIGH,
    ]),
    additionalInstructions: OpenAiAdditionalInstructionsSchema,
  })
  .strict();

export type OpenAiApiKeyBindingConfig = z.output<typeof OpenAiApiKeyBindingConfigSchema>;
