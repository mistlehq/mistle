import { z } from "zod";

export const FreestyleSandboxConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1, {
      message: "Freestyle config field `apiKey` is required.",
    }),
    baseUrl: z.url().optional(),
    idleTimeoutSeconds: z.number().int().positive().optional(),
  })
  .strict();

export type FreestyleSandboxConfig = z.input<typeof FreestyleSandboxConfigSchema>;
export type ValidatedFreestyleSandboxConfig = z.output<typeof FreestyleSandboxConfigSchema>;

export function validateFreestyleSandboxConfig(
  config: FreestyleSandboxConfig,
): ValidatedFreestyleSandboxConfig {
  return FreestyleSandboxConfigSchema.parse(config);
}
