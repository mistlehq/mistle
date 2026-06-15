import { z } from "zod";

export const ZaiBindingConfigSchema = z.object({}).strict();

export type ZaiBindingConfig = z.output<typeof ZaiBindingConfigSchema>;
