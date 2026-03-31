import { z } from "zod";

export const OpencodeRuntimeConfigSchema = z.object({}).strict();

export type OpencodeRuntimeConfig = z.output<typeof OpencodeRuntimeConfigSchema>;
