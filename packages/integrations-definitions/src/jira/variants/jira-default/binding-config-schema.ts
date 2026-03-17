import { z } from "zod";

export const JiraBindingConfigSchema = z.object({}).strict();

export type JiraBindingConfig = z.output<typeof JiraBindingConfigSchema>;
