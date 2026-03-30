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
  })
  .strict();
export type DockerStartSandboxRequest = z.output<typeof DockerStartSandboxRequestSchema>;

export const DockerResumeSandboxRequestSchema = z
  .object({
    runtimeId: z.string().trim().min(1, {
      message: "Docker request field `runtimeId` is required.",
    }),
  })
  .strict();
export type DockerResumeSandboxRequest = z.output<typeof DockerResumeSandboxRequestSchema>;

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
