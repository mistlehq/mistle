import { z } from "zod";

export const OpenCodeRuntimeConfigSchema = z.object({}).strict();

export type OpenCodeRuntimeConfig = z.output<typeof OpenCodeRuntimeConfigSchema>;
