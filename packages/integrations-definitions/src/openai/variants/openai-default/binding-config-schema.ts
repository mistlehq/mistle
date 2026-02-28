import { z } from "zod";

export const OpenAiRuntimes: {
  CODEX_CLI: "codex-cli";
} = {
  CODEX_CLI: "codex-cli",
};

export const OpenAiReasoningEfforts: {
  LOW: "low";
  MEDIUM: "medium";
  HIGH: "high";
} = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export const OpenAiApiKeyBindingConfigSchema = z
  .object({
    runtime: z.literal(OpenAiRuntimes.CODEX_CLI),
    defaultModel: z.string().min(1),
    reasoningEffort: z.enum([
      OpenAiReasoningEfforts.LOW,
      OpenAiReasoningEfforts.MEDIUM,
      OpenAiReasoningEfforts.HIGH,
    ]),
  })
  .strict();

export type OpenAiApiKeyBindingConfig = z.output<typeof OpenAiApiKeyBindingConfigSchema>;
