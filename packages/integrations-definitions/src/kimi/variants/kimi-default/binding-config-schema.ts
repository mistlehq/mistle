import { z } from "zod";

export const KimiBindingConfigSchema = z.object({}).strict();

export type KimiBindingConfig = z.output<typeof KimiBindingConfigSchema>;
