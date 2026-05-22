import { z } from "zod";

export const GcpTargetSecretSchema = z.object({}).strict();

export type GcpTargetSecrets = z.output<typeof GcpTargetSecretSchema>;
