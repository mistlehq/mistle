import { z } from "zod";

export const GoogleTargetSecretSchema = z.object({}).strict();

export type GoogleTargetSecrets = z.output<typeof GoogleTargetSecretSchema>;
