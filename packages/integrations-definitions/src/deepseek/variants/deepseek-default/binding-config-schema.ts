import { z } from "zod";

export const DeepSeekBindingConfigSchema = z.object({}).strict();

export type DeepSeekBindingConfig = z.output<typeof DeepSeekBindingConfigSchema>;
