import { z } from "@hono/zod-openapi";

const SandboxRuntimeProviderSelectionSchema = z
  .object({
    provider: z.enum(["docker", "e2b"]),
  })
  .strict();

export const MaterializeSandboxProfileVersionSnapshotJobRequestSchema = z
  .object({
    snapshotJobId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    image: z
      .object({
        imageId: z.string().min(1),
        createdAt: z.string().min(1),
        kind: z.literal("base"),
      })
      .strict(),
    sandboxRuntimeProvider: SandboxRuntimeProviderSelectionSchema.optional(),
  })
  .strict();

export const MaterializeSandboxProfileVersionSnapshotJobAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    snapshotJobId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type MaterializeSandboxProfileVersionSnapshotJobRequest = z.infer<
  typeof MaterializeSandboxProfileVersionSnapshotJobRequestSchema
>;
export type MaterializeSandboxProfileVersionSnapshotJobAcceptedResponse = z.infer<
  typeof MaterializeSandboxProfileVersionSnapshotJobAcceptedResponseSchema
>;
