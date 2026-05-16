import { z } from "zod";

import { SandboxSdkImageSandboxdSourceKinds } from "../../types.js";

export const TensorlakeSandboxConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1, {
      message: "Tensorlake config field `apiKey` is required.",
    }),
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

export type TensorlakeSandboxConfig = z.input<typeof TensorlakeSandboxConfigSchema>;
export type ValidatedTensorlakeSandboxConfig = z.output<typeof TensorlakeSandboxConfigSchema>;

export const TensorlakeStartImageKinds = {
  IMAGE: "image",
  SNAPSHOT: "snapshot",
} as const;
export type TensorlakeStartImageKind =
  (typeof TensorlakeStartImageKinds)[keyof typeof TensorlakeStartImageKinds];

export const TensorlakeStartSandboxRequestSchema = z
  .object({
    sandboxInstanceId: z.string().trim().min(1, {
      message: "Tensorlake request field `sandboxInstanceId` is required.",
    }),
    image: z.object({
      kind: z.enum([TensorlakeStartImageKinds.IMAGE, TensorlakeStartImageKinds.SNAPSHOT]),
      id: z.string().trim().min(1, {
        message: "Tensorlake request field `image.id` is required.",
      }),
      sourceBaseImageRef: z
        .string()
        .trim()
        .min(1, {
          message: "Tensorlake request field `image.sourceBaseImageRef` must be non-empty.",
        })
        .optional(),
    }),
    env: z.record(z.string().trim().min(1), z.string()).optional(),
    resources: z
      .object({
        vcpuCount: z.number().int().min(1),
        memoryMb: z.number().int().min(1),
        storageMb: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TensorlakeStartSandboxRequest = z.output<typeof TensorlakeStartSandboxRequestSchema>;

export const TensorlakeSandboxIdRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Tensorlake request field `sandboxId` is required.",
    }),
  })
  .strict();
export type TensorlakeSandboxIdRequest = z.output<typeof TensorlakeSandboxIdRequestSchema>;

export const TensorlakeRuntimeControlRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Tensorlake request field `sandboxId` is required.",
    }),
    env: z.record(z.string().trim().min(1), z.string()).optional(),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "Tensorlake request field `payload` must be a Uint8Array.",
    }),
  })
  .strict();
export type TensorlakeRuntimeControlRequest = z.output<
  typeof TensorlakeRuntimeControlRequestSchema
>;
