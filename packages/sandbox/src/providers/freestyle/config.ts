import { z } from "zod";

import { SandboxSdkImageSandboxdSourceKinds } from "../../types.js";

export const FreestyleSandboxConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1, {
      message: "Freestyle config field `apiKey` is required.",
    }),
    baseUrl: z.url().optional(),
    idleTimeoutSeconds: z.number().int().positive().optional(),
    sandboxd: z
      .object({
        kind: z.literal(SandboxSdkImageSandboxdSourceKinds.RELEASE),
        artifact: z
          .object({
            version: z.string().trim().min(1),
            url: z.url(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type FreestyleSandboxConfig = z.input<typeof FreestyleSandboxConfigSchema>;
export type ValidatedFreestyleSandboxConfig = z.output<typeof FreestyleSandboxConfigSchema>;

export function validateFreestyleSandboxConfig(
  config: FreestyleSandboxConfig,
): ValidatedFreestyleSandboxConfig {
  return FreestyleSandboxConfigSchema.parse(config);
}
