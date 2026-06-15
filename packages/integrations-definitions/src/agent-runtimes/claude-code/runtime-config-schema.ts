import { z } from "zod";

export const ClaudeCodeRuntimeConfigSchema = z.object({}).strict();

export type ClaudeCodeRuntimeConfig = z.output<typeof ClaudeCodeRuntimeConfigSchema>;
