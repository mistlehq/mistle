import { z } from "@hono/zod-openapi";

import { SandboxRuntimeProviderInputSchema } from "../../../sandbox-instances/start-sandbox-instance/schema.js";

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
        provider: z.enum(["docker", "e2b", "tensorlake"]),
      })
      .strict(),
    sandboxRuntime: SandboxRuntimeProviderInputSchema,
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
