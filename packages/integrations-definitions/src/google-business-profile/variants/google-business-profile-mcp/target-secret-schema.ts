import { z } from "zod";

export const GoogleBusinessProfileTargetSecretSchema = z.object({}).strict();

export type GoogleBusinessProfileTargetSecrets = z.output<
  typeof GoogleBusinessProfileTargetSecretSchema
>;
