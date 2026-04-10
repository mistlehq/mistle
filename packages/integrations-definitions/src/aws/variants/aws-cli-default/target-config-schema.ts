import { z } from "zod";

export const AwsTargetConfigSchema = z.object({}).strict();

export type AwsTargetConfig = z.output<typeof AwsTargetConfigSchema>;
