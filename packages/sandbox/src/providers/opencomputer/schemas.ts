import { z } from "zod";

import { SandboxSdkImageSandboxdSourceKinds, type SandboxStartResources } from "../../types.js";

type OpenComputerResourceInput = {
  readonly vcpuCount: number;
  readonly memoryMb: number;
  readonly diskMb?: number | undefined;
};

export const OpenComputerDefaultApiBaseUrl = "https://app.opencomputer.dev/api";
export const OpenComputerSandboxTimeoutSeconds = 0;

export const OpenComputerImageHandleKinds = {
  IMAGE: "image",
  SNAPSHOT: "snapshot",
  CHECKPOINT: "checkpoint",
  TEMPLATE: "template",
} as const;
export type OpenComputerImageHandleKind =
  (typeof OpenComputerImageHandleKinds)[keyof typeof OpenComputerImageHandleKinds];

export const OpenComputerSnapshotStates = {
  BUILDING: "building",
  READY: "ready",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type OpenComputerSnapshotState =
  (typeof OpenComputerSnapshotStates)[keyof typeof OpenComputerSnapshotStates];

export const OpenComputerSandboxStatuses = {
  PENDING: "pending",
  CREATING: "creating",
  RUNNING: "running",
  HIBERNATING: "hibernating",
  HIBERNATED: "hibernated",
  STOPPED: "stopped",
  DELETED: "deleted",
  KILLED: "killed",
  FAILED: "failed",
} as const;
export type OpenComputerSandboxStatus =
  (typeof OpenComputerSandboxStatuses)[keyof typeof OpenComputerSandboxStatuses];

export const OpenComputerImageManifestStepSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("apt_install"),
      args: z.object({ packages: z.array(z.string()) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("pip_install"),
      args: z.object({ packages: z.array(z.string()) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("run"),
      args: z.object({ commands: z.array(z.string()) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("env"),
      args: z.object({ vars: z.record(z.string(), z.string()) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("workdir"),
      args: z.object({ path: z.string().trim().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("add_file"),
      args: z
        .object({
          path: z.string().trim().min(1),
          content: z.string(),
          encoding: z.literal("base64"),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("add_dir"),
      args: z
        .object({
          path: z.string().trim().min(1),
          files: z.array(
            z
              .object({
                relativePath: z.string().trim().min(1),
                content: z.string(),
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict(),
]);

export const OpenComputerImageManifestSchema = z
  .object({
    base: z.literal("base"),
    steps: z.array(OpenComputerImageManifestStepSchema),
  })
  .strict();
export type OpenComputerImageManifest = z.output<typeof OpenComputerImageManifestSchema>;

export const OpenComputerValidResourceTiers = [
  { vcpuCount: 1, memoryMb: 1024 },
  { vcpuCount: 1, memoryMb: 4096 },
  { vcpuCount: 2, memoryMb: 8192 },
  { vcpuCount: 4, memoryMb: 16_384 },
  { vcpuCount: 8, memoryMb: 32_768 },
  { vcpuCount: 16, memoryMb: 65_536 },
] as const satisfies readonly SandboxStartResources[];

export const OpenComputerSandboxConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1, {
      message: "OpenComputer config field `apiKey` is required.",
    }),
    apiBaseUrl: z.url().optional(),
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
export type OpenComputerSandboxConfig = z.input<typeof OpenComputerSandboxConfigSchema>;
export type ValidatedOpenComputerSandboxConfig = z.output<typeof OpenComputerSandboxConfigSchema>;

export const OpenComputerStartImageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(OpenComputerImageHandleKinds.IMAGE),
      id: z.string().trim().min(1),
      manifest: OpenComputerImageManifestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal(OpenComputerImageHandleKinds.SNAPSHOT),
      id: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal(OpenComputerImageHandleKinds.CHECKPOINT),
      id: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal(OpenComputerImageHandleKinds.TEMPLATE),
      id: z.string().trim().min(1),
    })
    .strict(),
]);
export type OpenComputerStartImage = z.output<typeof OpenComputerStartImageSchema>;

export const OpenComputerCreateSnapshotImageRequestSchema = z
  .object({
    imageId: z.string().trim().min(1),
  })
  .strict();
export type OpenComputerCreateSnapshotImageRequest = z.output<
  typeof OpenComputerCreateSnapshotImageRequestSchema
>;

export const OpenComputerSandboxIdRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "OpenComputer request field `sandboxId` is required.",
    }),
  })
  .strict();
export type OpenComputerSandboxIdRequest = z.output<typeof OpenComputerSandboxIdRequestSchema>;

export const OpenComputerStartSandboxRequestSchema = z
  .object({
    sandboxInstanceId: z.string().trim().min(1).optional(),
    image: OpenComputerStartImageSchema,
    env: z.record(z.string().trim().min(1), z.string()).optional(),
    resources: z
      .object({
        vcpuCount: z.number().int().min(1),
        memoryMb: z.number().int().min(1),
        diskMb: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type OpenComputerStartSandboxRequest = z.output<
  typeof OpenComputerStartSandboxRequestSchema
>;

export const OpenComputerCaptureSandboxSnapshotRequestSchema =
  OpenComputerSandboxIdRequestSchema.extend({
    name: z.string().trim().min(1),
    requestTimeoutMs: z.number().int().positive().optional(),
  }).strict();
export type OpenComputerCaptureSandboxSnapshotRequest = z.output<
  typeof OpenComputerCaptureSandboxSnapshotRequestSchema
>;

export const OpenComputerVerifyCheckpointStartableRequestSchema = z
  .object({
    checkpointId: z.string().trim().min(1),
    requestTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type OpenComputerVerifyCheckpointStartableRequest = z.output<
  typeof OpenComputerVerifyCheckpointStartableRequestSchema
>;

export const OpenComputerRuntimeControlRequestSchema = z
  .object({
    sandboxId: z.string().trim().min(1, {
      message: "OpenComputer request field `sandboxId` is required.",
    }),
    env: z.record(z.string().trim().min(1), z.string()).optional(),
    payload: z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array, {
      message: "OpenComputer request field `payload` must be a Uint8Array.",
    }),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type OpenComputerRuntimeControlRequest = z.output<
  typeof OpenComputerRuntimeControlRequestSchema
>;

export function validateOpenComputerStartResources(resources: OpenComputerResourceInput): void {
  const validTier = OpenComputerValidResourceTiers.some(
    (tier) => tier.vcpuCount === resources.vcpuCount && tier.memoryMb === resources.memoryMb,
  );
  if (!validTier) {
    throw new Error(
      `OpenComputer resources must match a supported tier: ${OpenComputerValidResourceTiers.map(
        (tier) => `${String(tier.vcpuCount)} vCPU / ${String(tier.memoryMb)} MB`,
      ).join(", ")}.`,
    );
  }
}

export function createOpenComputerResourceFields(
  resources: OpenComputerResourceInput | undefined,
): { cpuCount?: number; memoryMB?: number; diskMB?: number } {
  if (resources === undefined) {
    return {};
  }
  validateOpenComputerStartResources(resources);
  return {
    cpuCount: resources.vcpuCount,
    memoryMB: resources.memoryMb,
    ...(resources.diskMb === undefined ? {} : { diskMB: resources.diskMb }),
  };
}
