import { z } from "zod";

export const GoogleBindingConfigSchema = z.object({}).strict();

export type GoogleBindingConfig = z.output<typeof GoogleBindingConfigSchema>;
