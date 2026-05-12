import { z } from "zod";

export const OpenCodeGoBindingConfigSchema = z.object({}).strict();

export type OpenCodeGoBindingConfig = z.output<typeof OpenCodeGoBindingConfigSchema>;
