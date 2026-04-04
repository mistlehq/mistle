import { z } from "zod";

export const SandboxRuntimeAttachmentSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    ownerLeaseId: z.string().min(1),
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
    attachedAtMs: z.number().int().nonnegative(),
  })
  .strict();

export const SandboxRuntimeStateSnapshotSchema = z
  .object({
    ownerLeaseId: z.string().min(1).nullable(),
    attachment: SandboxRuntimeAttachmentSchema.nullable(),
  })
  .strict();

export type SandboxRuntimeAttachment = z.infer<typeof SandboxRuntimeAttachmentSchema>;
export type SandboxRuntimeStateSnapshot = z.infer<typeof SandboxRuntimeStateSnapshotSchema>;
