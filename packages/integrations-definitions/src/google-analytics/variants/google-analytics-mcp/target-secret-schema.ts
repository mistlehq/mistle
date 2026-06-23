import { z } from "zod";

export const GoogleAnalyticsTargetSecretSchema = z.object({}).strict();

export type GoogleAnalyticsTargetSecrets = z.output<typeof GoogleAnalyticsTargetSecretSchema>;
