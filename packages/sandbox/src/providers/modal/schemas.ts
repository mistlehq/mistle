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
    environmentName: z
      .string()
      .trim()
      .min(1, {
        message: "Modal config field `environmentName` must be non-empty when provided.",
      })
      .optional(),
  })
  .strict();

export type ModalSandboxConfig = z.output<typeof ModalSandboxConfigSchema>;

export const ModalStartSandboxRequestSchema = z
  .object({
    imageId: z.string().trim().min(1, {
      message: "Modal request field `imageId` is required.",
    }),
    env: z
      .record(
        z.string().trim().min(1, {
          message: "Modal request field `env` keys must be non-empty.",
        }),
        z.string(),
      )
      .optional(),
  })
  .strict();
export type ModalStartSandboxRequest = z.output<typeof ModalStartSandboxRequestSchema>;

export const ModalResumeSandboxRequestSchema = z
  .object({
    imageId: z.string().trim().min(1, {
      message: "Modal request field `imageId` is required.",
    }),
    env: z
      .record(
        z.string().trim().min(1, {
          message: "Modal request field `env` keys must be non-empty.",
        }),
        z.string(),
      )
      .optional(),
  })
  .strict();
export type ModalResumeSandboxRequest = z.output<typeof ModalResumeSandboxRequestSchema>;

export const ModalWriteSandboxStdinRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Modal request field `runtimeId` is required.",
    }),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "Modal request field `payload` must be a Uint8Array.",
    }),
  })
  .strict();
export type ModalWriteSandboxStdinRequest = z.output<typeof ModalWriteSandboxStdinRequestSchema>;

export const ModalCloseSandboxStdinRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Modal request field `runtimeId` is required.",
    }),
  })
  .strict();
export type ModalCloseSandboxStdinRequest = z.output<typeof ModalCloseSandboxStdinRequestSchema>;

export const ModalStopSandboxRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Modal request field `runtimeId` is required.",
    }),
  })
  .strict();
export type ModalStopSandboxRequest = z.output<typeof ModalStopSandboxRequestSchema>;

export const ModalDestroySandboxRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Modal request field `runtimeId` is required.",
    }),
  })
  .strict();
export type ModalDestroySandboxRequest = z.output<typeof ModalDestroySandboxRequestSchema>;
