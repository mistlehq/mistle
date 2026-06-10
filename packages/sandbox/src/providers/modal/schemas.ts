import { z } from "zod";

export const ModalSandboxIdRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Modal request field `sandboxId` is required.",
    }),
  })
  .strict();
export type ModalSandboxIdRequest = z.output<typeof ModalSandboxIdRequestSchema>;

export const ModalImageRequestSchema = z
  .object({
    imageId: z.string().trim().min(1, {
      message: "Modal request field `imageId` is required.",
    }),
  })
  .strict();
export type ModalImageRequest = z.output<typeof ModalImageRequestSchema>;

export const ModalStartSandboxRequestSchema = z
  .object({
    sandboxInstanceId: z.string().trim().min(1).optional(),
    imageId: z.string().trim().min(1, {
      message: "Modal request field `imageId` is required.",
    }),
    env: z.record(z.string().trim().min(1), z.string()).optional(),
    resources: z
      .object({
        vcpuCount: z.number().positive(),
        memoryMb: z.number().int().min(1),
        diskMb: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ModalStartSandboxRequest = z.output<typeof ModalStartSandboxRequestSchema>;

export const ModalCaptureSandboxSnapshotRequestSchema = ModalSandboxIdRequestSchema.extend({
  requestTimeoutMs: z.number().int().positive().optional(),
}).strict();
export type ModalCaptureSandboxSnapshotRequest = z.output<
  typeof ModalCaptureSandboxSnapshotRequestSchema
>;

export const ModalRuntimeControlRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Modal request field `sandboxId` is required.",
    }),
    env: z.record(z.string().trim().min(1), z.string()).optional(),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "Modal request field `payload` must be a Uint8Array.",
    }),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export type ModalRuntimeControlRequest = z.output<typeof ModalRuntimeControlRequestSchema>;

export function validateModalStartResources(resources: {
  readonly diskMb?: number | undefined;
}): void {
  if (resources.diskMb !== undefined) {
    throw new Error("Modal sandbox runtime does not support configurable disk.");
  }
}
