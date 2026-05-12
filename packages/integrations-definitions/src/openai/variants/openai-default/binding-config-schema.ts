import { z } from "zod";

export const OpenAiApiKeyBindingConfigSchema = z.object({}).strict();

export type OpenAiApiKeyBindingConfig = z.output<typeof OpenAiApiKeyBindingConfigSchema>;
