import { z } from "zod";

export const OpenRouterBindingConfigSchema = z.object({}).strict();

export type OpenRouterBindingConfig = z.output<typeof OpenRouterBindingConfigSchema>;
