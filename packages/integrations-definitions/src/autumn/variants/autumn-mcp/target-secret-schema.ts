import { z } from "zod";

export const AutumnTargetSecretSchema = z.object({}).strict();

export type AutumnTargetSecrets = z.output<typeof AutumnTargetSecretSchema>;
