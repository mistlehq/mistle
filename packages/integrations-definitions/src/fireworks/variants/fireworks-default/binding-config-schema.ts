import { z } from "zod";

export const FireworksBindingConfigSchema = z.object({}).strict();

export type FireworksBindingConfig = z.output<typeof FireworksBindingConfigSchema>;
