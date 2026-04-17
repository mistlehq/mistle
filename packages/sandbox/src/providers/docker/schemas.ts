import { z } from "zod";

export const DockerSandboxConfigSchema = z
  .object({
    socketPath: z.string().trim().min(1, {
      message: "Docker config field `socketPath` is required.",
    }),
    networkName: z.string().trim().min(1).optional(),
  })
  .strict();

export type DockerSandboxConfig = z.output<typeof DockerSandboxConfigSchema>;

const DockerStorageAttachmentBindingSchema = z
  .object({
    sourcePath: z.string().trim().min(1, {
      message:
        "Docker request field `storagePreparation.layout.bindings[].sourcePath` is required.",
    }),
    targetPath: z.string().trim().min(1, {
      message:
        "Docker request field `storagePreparation.layout.bindings[].targetPath` is required.",
    }),
  })
  .strict();

const DockerVolumeStoragePreparationSchema = z
  .object({
    backend: z.literal("docker_volume"),
    handle: z.string().trim().min(1, {
      message: "Docker request field `storagePreparation.handle` is required.",
    }),
    layout: z
      .object({
        bindings: z.array(DockerStorageAttachmentBindingSchema),
      })
      .strict(),
  })
  .strict();

export type DockerVolumeStoragePreparation = z.output<typeof DockerVolumeStoragePreparationSchema>;

export const DockerStartSandboxRequestSchema = z
  .object({
    imageRef: z.string().trim().min(1, {
      message: "Docker request field `imageRef` is required.",
    }),
    env: z
      .record(
        z.string().trim().min(1, {
          message: "Docker request field `env` keys must be non-empty.",
        }),
        z.string(),
      )
      .optional(),
    storagePreparation: DockerVolumeStoragePreparationSchema.optional(),
  })
  .strict();
export type DockerStartSandboxRequest = z.output<typeof DockerStartSandboxRequestSchema>;

export const DockerPrepareVolumeForStartRequestSchema = z
  .object({
    storagePreparation: DockerVolumeStoragePreparationSchema,
  })
  .strict();
export type DockerPrepareVolumeForStartRequest = z.output<
  typeof DockerPrepareVolumeForStartRequestSchema
>;

export const DockerResumeSandboxRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Docker request field `runtimeId` is required.",
    }),
  })
  .strict();
export type DockerResumeSandboxRequest = z.output<typeof DockerResumeSandboxRequestSchema>;

export const DockerCreateVolumeRequestSchema = z
  .object({
    volumeName: z.string().trim().min(1, {
      message: "Docker request field `volumeName` is required.",
    }),
  })
  .strict();
export type DockerCreateVolumeRequest = z.output<typeof DockerCreateVolumeRequestSchema>;

export const DockerDeleteVolumeRequestSchema = z
  .object({
    volumeName: z.string().trim().min(1, {
      message: "Docker request field `volumeName` is required.",
    }),
  })
  .strict();
export type DockerDeleteVolumeRequest = z.output<typeof DockerDeleteVolumeRequestSchema>;

export const DockerInspectSandboxRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Docker request field `runtimeId` is required.",
    }),
  })
  .strict();
export type DockerInspectSandboxRequest = z.output<typeof DockerInspectSandboxRequestSchema>;

export const DockerStopSandboxRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Docker request field `runtimeId` is required.",
    }),
  })
  .strict();
export type DockerStopSandboxRequest = z.output<typeof DockerStopSandboxRequestSchema>;

export const DockerDestroySandboxRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Docker request field `runtimeId` is required.",
    }),
  })
  .strict();
export type DockerDestroySandboxRequest = z.output<typeof DockerDestroySandboxRequestSchema>;
