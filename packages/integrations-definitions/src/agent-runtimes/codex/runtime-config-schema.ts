import { z } from "zod";

export const CodexRuntimeConfigSchema = z.object({}).strict();

export type CodexRuntimeConfig = z.output<typeof CodexRuntimeConfigSchema>;
