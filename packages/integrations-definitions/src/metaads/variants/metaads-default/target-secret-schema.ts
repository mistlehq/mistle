import { z } from "zod";

export const MetaAdsTargetSecretSchema = z.object({}).strict();

export type MetaAdsTargetSecrets = z.output<typeof MetaAdsTargetSecretSchema>;
