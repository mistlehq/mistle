import { z } from "zod";

export const ModalSandboxConfigSchema = z
  .object({
    tokenId: z.string().trim().min(1, {
      message: "Modal config field `tokenId` is required.",
    }),
    tokenSecret: z.string().trim().min(1, {
      message: "Modal config field `tokenSecret` is required.",
    }),
    appName: z.string().trim().min(1, {
      message: "Modal config field `appName` is required.",
    }),
    environment: z.string().trim().min(1).optional(),
    defaultTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export type ModalSandboxConfig = z.input<typeof ModalSandboxConfigSchema>;
export type ValidatedModalSandboxConfig = z.output<typeof ModalSandboxConfigSchema>;

export function validateModalSandboxConfig(
  config: ModalSandboxConfig,
): ValidatedModalSandboxConfig {
  return ModalSandboxConfigSchema.parse(config);
}
