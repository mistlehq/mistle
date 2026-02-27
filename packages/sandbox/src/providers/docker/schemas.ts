import { z } from "zod";

export const DockerSandboxConfigSchema = z
  .object({
    socketPath: z.string().trim().min(1, {
      message: "Docker config field `socketPath` is required.",
    }),
    snapshotRepository: z.string().trim().min(1, {
      message: "Docker config field `snapshotRepository` is required.",
    }),
  })
  .strict();

export type DockerSandboxConfig = z.output<typeof DockerSandboxConfigSchema>;

export const DockerStartSandboxRequestSchema = z
  .object({
    imageRef: z.string().trim().min(1, {
      message: "Docker request field `imageRef` is required.",
    }),
  })
  .strict();
export type DockerStartSandboxRequest = z.output<typeof DockerStartSandboxRequestSchema>;

export const DockerWriteSandboxStdinRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Docker request field `sandboxId` is required.",
    }),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "Docker request field `payload` must be a Uint8Array.",
    }),
  })
  .strict();
export type DockerWriteSandboxStdinRequest = z.output<typeof DockerWriteSandboxStdinRequestSchema>;

export const DockerCloseSandboxStdinRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Docker request field `sandboxId` is required.",
    }),
  })
  .strict();
export type DockerCloseSandboxStdinRequest = z.output<typeof DockerCloseSandboxStdinRequestSchema>;

export const DockerSnapshotSandboxRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Docker request field `sandboxId` is required.",
    }),
  })
  .strict();
export type DockerSnapshotSandboxRequest = z.output<typeof DockerSnapshotSandboxRequestSchema>;

export const DockerStopSandboxRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "Docker request field `sandboxId` is required.",
    }),
  })
  .strict();
export type DockerStopSandboxRequest = z.output<typeof DockerStopSandboxRequestSchema>;
