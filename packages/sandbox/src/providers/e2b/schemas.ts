import { z } from "zod";

export const E2BSandboxConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1, {
      message: "E2B config field `apiKey` is required.",
    }),
    domain: z.string().trim().min(1).optional(),
  })
  .strict();

export type E2BSandboxConfig = z.output<typeof E2BSandboxConfigSchema>;

export const E2BStartSandboxRequestSchema = z
  .object({
    imageRef: z.string().trim().min(1, {
      message: "E2B request field `imageRef` is required.",
    }),
    env: z
      .record(
        z.string().trim().min(1, {
          message: "E2B request field `env` keys must be non-empty.",
        }),
        z.string(),
      )
      .optional(),
  })
  .strict();
export type E2BStartSandboxRequest = z.output<typeof E2BStartSandboxRequestSchema>;

export const E2BResumeSandboxRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "E2B request field `sandboxId` is required.",
    }),
  })
  .strict();
export type E2BResumeSandboxRequest = z.output<typeof E2BResumeSandboxRequestSchema>;

export const E2BStopSandboxRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "E2B request field `sandboxId` is required.",
    }),
  })
  .strict();
export type E2BStopSandboxRequest = z.output<typeof E2BStopSandboxRequestSchema>;

export const E2BDestroySandboxRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "E2B request field `sandboxId` is required.",
    }),
  })
  .strict();
export type E2BDestroySandboxRequest = z.output<typeof E2BDestroySandboxRequestSchema>;

export const E2BApplyStartupRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "E2B request field `sandboxId` is required.",
    }),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "E2B request field `payload` must be a Uint8Array.",
    }),
  })
  .strict();
export type E2BApplyStartupRequest = z.output<typeof E2BApplyStartupRequestSchema>;
