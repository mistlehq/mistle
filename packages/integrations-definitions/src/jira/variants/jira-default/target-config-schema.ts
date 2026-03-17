import { z } from "zod";

export const JiraTargetConfigSchema = z.object({}).strict();

export type JiraTargetConfig = z.output<typeof JiraTargetConfigSchema>;
