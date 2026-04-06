import { z } from "zod";

export const JiraTargetSecretSchema = z.object({}).strict();

export type JiraTargetSecrets = z.output<typeof JiraTargetSecretSchema>;
