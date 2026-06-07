import { z } from "zod";

import type { SandboxStartResources } from "../../types.js";

export const FreestyleVmStates = {
  BUILDING: "building",
  STARTING: "starting",
  RUNNING: "running",
  SUSPENDING: "suspending",
  SUSPENDED: "suspended",
  STOPPED: "stopped",
  LOST: "lost",
} as const;
export type FreestyleVmState = (typeof FreestyleVmStates)[keyof typeof FreestyleVmStates];

export const FreestyleMaxVcpuCount = 32;
export const FreestyleMaxMemoryGb = 32;
export const FreestyleMaxDiskGb = 64;

export const FreestyleSandboxIdRequestSchema = z
  .object({
    vmId: z.string().trim().min(1, {
      message: "Freestyle request field `vmId` is required.",
    }),
  })
  .strict();
export type FreestyleSandboxIdRequest = z.output<typeof FreestyleSandboxIdRequestSchema>;

export const FreestyleStartSandboxRequestSchema = z
  .object({
    sandboxInstanceId: z.string().trim().min(1).optional(),
    snapshotId: z.string().trim().min(1, {
      message: "Freestyle request field `snapshotId` is required.",
    }),
    env: z.record(z.string().trim().min(1), z.string()).optional(),
    idleTimeoutSeconds: z.number().int().positive().optional(),
    resources: z
      .object({
        vcpuCount: z.number().int().min(1).max(FreestyleMaxVcpuCount),
        memoryMb: z.number().int().min(1),
        diskMb: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type FreestyleStartSandboxRequest = z.output<typeof FreestyleStartSandboxRequestSchema>;

export const FreestyleCaptureSandboxSnapshotRequestSchema = FreestyleSandboxIdRequestSchema.extend({
  requestTimeoutMs: z.number().int().positive().optional(),
}).strict();
export type FreestyleCaptureSandboxSnapshotRequest = z.output<
  typeof FreestyleCaptureSandboxSnapshotRequestSchema
>;

export const FreestyleRuntimeControlRequestSchema = z
  .object({
    vmId: z.string().trim().min(1, {
      message: "Freestyle request field `vmId` is required.",
    }),
    env: z.record(z.string().trim().min(1), z.string()).optional(),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "Freestyle request field `payload` must be a Uint8Array.",
    }),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export type FreestyleRuntimeControlRequest = z.output<typeof FreestyleRuntimeControlRequestSchema>;

export const FreestyleCreateSnapshotImageRequestSchema = z
  .object({
    imageId: z.string().trim().min(1),
    baseImageRef: z.string().trim().min(1),
    cmddirBase64: z.string().trim().min(1),
    sandboxd: z
      .object({
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
export type FreestyleCreateSnapshotImageRequest = z.output<
  typeof FreestyleCreateSnapshotImageRequestSchema
>;

export function validateFreestyleStartResources(resources: SandboxStartResources): void {
  if (!isPowerOfTwo(resources.vcpuCount)) {
    throw new Error("Freestyle vCPU count must be a power of two.");
  }
  if (resources.vcpuCount > FreestyleMaxVcpuCount) {
    throw new Error(
      `Freestyle vCPU count must be less than or equal to ${String(FreestyleMaxVcpuCount)}.`,
    );
  }

  const memoryGb = memoryMbToGb(resources.memoryMb);
  if (memoryGb === null || !isPowerOfTwo(memoryGb)) {
    throw new Error("Freestyle memory must be a whole GiB power of two.");
  }
  if (memoryGb > FreestyleMaxMemoryGb) {
    throw new Error(
      `Freestyle memory must be less than or equal to ${String(FreestyleMaxMemoryGb)} GiB.`,
    );
  }

  if (resources.diskMb !== undefined) {
    const diskGb = memoryMbToGb(resources.diskMb);
    if (diskGb === null) {
      throw new Error("Freestyle disk size must be a whole GiB value.");
    }
    if (diskGb > FreestyleMaxDiskGb) {
      throw new Error(
        `Freestyle disk size must be less than or equal to ${String(FreestyleMaxDiskGb)} GiB.`,
      );
    }
  }
}

export function memoryMbToGb(memoryMb: number): number | null {
  if (!Number.isInteger(memoryMb) || memoryMb <= 0 || memoryMb % 1024 !== 0) {
    return null;
  }
  return memoryMb / 1024;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}
