import { z } from "zod";

export const E2BDefaultTemplateCpuCount = 2;
export const E2BDefaultTemplateMemoryMb = 4 * 1024;

export const E2BSandboxConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1, {
      message: "E2B config field `apiKey` is required.",
    }),
    domain: z.string().trim().min(1).optional(),
    cpuCount: z.number().int().min(1).default(E2BDefaultTemplateCpuCount),
    memoryMb: z.number().int().min(1).default(E2BDefaultTemplateMemoryMb),
  })
  .strict();

export type E2BSandboxConfig = z.input<typeof E2BSandboxConfigSchema>;
export type ValidatedE2BSandboxConfig = z.output<typeof E2BSandboxConfigSchema>;

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

export const E2BInspectSandboxRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "E2B request field `sandboxId` is required.",
    }),
  })
  .strict();
export type E2BInspectSandboxRequest = z.output<typeof E2BInspectSandboxRequestSchema>;

export const E2BCaptureSandboxSnapshotRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "E2B request field `sandboxId` is required.",
    }),
  })
  .strict();
export type E2BCaptureSandboxSnapshotRequest = z.output<
  typeof E2BCaptureSandboxSnapshotRequestSchema
>;

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

export const E2BInitRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "E2B request field `sandboxId` is required.",
    }),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "E2B request field `payload` must be a Uint8Array.",
    }),
  })
  .strict();
export type E2BInitRequest = z.output<typeof E2BInitRequestSchema>;
