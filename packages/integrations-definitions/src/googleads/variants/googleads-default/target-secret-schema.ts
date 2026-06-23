import { z } from "zod";

export const GoogleAdsTargetSecretSchema = z.object({}).strict();

export type GoogleAdsTargetSecrets = z.output<typeof GoogleAdsTargetSecretSchema>;
