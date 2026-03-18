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

const DockerVolumeMountSchema = z
  .object({
    volumeId: z.string().trim().min(1, {
      message: "Docker request field `volumeId` is required.",
    }),
    mountPath: z.string().trim().min(1, {
      message: "Docker request field `mountPath` is required.",
    }),
  })
  .strict();
export type DockerVolumeMount = z.output<typeof DockerVolumeMountSchema>;

export const DockerStartSandboxRequestSchema = z
  .object({
    imageRef: z.string().trim().min(1, {
      message: "Docker request field `imageRef` is required.",
    }),
    mounts: z.array(DockerVolumeMountSchema).optional(),
    env: z
      .record(
        z.string().trim().min(1, {
          message: "Docker request field `env` keys must be non-empty.",
        }),
        z.string(),
      )
      .optional(),
  })
  .strict();
export type DockerStartSandboxRequest = z.output<typeof DockerStartSandboxRequestSchema>;

export const DockerWriteSandboxStdinRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Docker request field `runtimeId` is required.",
    }),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "Docker request field `payload` must be a Uint8Array.",
    }),
  })
  .strict();
export type DockerWriteSandboxStdinRequest = z.output<typeof DockerWriteSandboxStdinRequestSchema>;

export const DockerCloseSandboxStdinRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Docker request field `runtimeId` is required.",
    }),
  })
  .strict();
export type DockerCloseSandboxStdinRequest = z.output<typeof DockerCloseSandboxStdinRequestSchema>;

export const DockerCreateVolumeRequestSchema = z.object({}).strict();
export type DockerCreateVolumeRequest = z.output<typeof DockerCreateVolumeRequestSchema>;

export const DockerDeleteVolumeRequestSchema = z
  .object({
    volumeId: z.string().trim().min(1, {
      message: "Docker request field `volumeId` is required.",
    }),
  })
  .strict();
export type DockerDeleteVolumeRequest = z.output<typeof DockerDeleteVolumeRequestSchema>;

export const DockerStopSandboxRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Docker request field `runtimeId` is required.",
    }),
  })
  .strict();
export type DockerStopSandboxRequest = z.output<typeof DockerStopSandboxRequestSchema>;
