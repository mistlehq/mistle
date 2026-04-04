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

export const SandboxRuntimePresenceSummarySchema = z
  .object({
    activeCount: z.number().int().nonnegative(),
  })
  .strict();

export const SandboxRuntimeKeepaliveSummarySchema = z
  .object({
    active: z.boolean(),
  })
  .strict();

export const SandboxRuntimeStateSnapshotSchema = z
  .object({
    ownerLeaseId: z.string().min(1).nullable(),
    attachment: SandboxRuntimeAttachmentSchema.nullable(),
    presence: SandboxRuntimePresenceSummarySchema,
    keepalive: SandboxRuntimeKeepaliveSummarySchema,
  })
  .strict();

export type SandboxRuntimeAttachment = z.infer<typeof SandboxRuntimeAttachmentSchema>;
export type SandboxRuntimeKeepaliveSummary = z.infer<typeof SandboxRuntimeKeepaliveSummarySchema>;
export type SandboxRuntimePresenceSummary = z.infer<typeof SandboxRuntimePresenceSummarySchema>;
export type SandboxRuntimeStateSnapshot = z.infer<typeof SandboxRuntimeStateSnapshotSchema>;
