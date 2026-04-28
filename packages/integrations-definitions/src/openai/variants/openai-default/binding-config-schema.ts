import { z } from "zod";

export const OpenAiAllowedRuntimeIds = ["codex"] as const;

export const OpenAiApiKeyBindingConfigSchema = z
  .object({
    runtime: z
      .object({
        runtimeId: z.enum(OpenAiAllowedRuntimeIds),
        config: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();

export type OpenAiApiKeyBindingConfig = z.output<typeof OpenAiApiKeyBindingConfigSchema>;
