import { z } from "zod";

export const AwsTargetSecretSchema = z.object({}).strict();

export type AwsTargetSecrets = z.output<typeof AwsTargetSecretSchema>;
