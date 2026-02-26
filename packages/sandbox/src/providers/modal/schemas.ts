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
  })
  .strict();
export type ModalStartSandboxRequest = z.output<typeof ModalStartSandboxRequestSchema>;

export const ModalSnapshotSandboxRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Modal request field `sandboxId` is required.",
    }),
  })
  .strict();
export type ModalSnapshotSandboxRequest = z.output<typeof ModalSnapshotSandboxRequestSchema>;

export const ModalStopSandboxRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Modal request field `sandboxId` is required.",
    }),
  })
  .strict();
export type ModalStopSandboxRequest = z.output<typeof ModalStopSandboxRequestSchema>;
