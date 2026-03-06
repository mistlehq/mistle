import { z } from "zod";

export const LinearBindingConfigSchema = z.object({}).strict();

export type LinearBindingConfig = z.output<typeof LinearBindingConfigSchema>;
