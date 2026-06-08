import { z } from "zod";

export const CloudflareTargetSecretSchema = z.object({}).strict();

export type CloudflareTargetSecrets = z.output<typeof CloudflareTargetSecretSchema>;
