import { z } from "@hono/zod-openapi";

export const InternalSandboxRuntimeStartProfileInstanceRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    profileId: z.string().min(1),
    profileVersion: z.number().int().min(1),
    startedBy: z
      .object({
        kind: z.union([z.literal("user"), z.literal("system")]),
        id: z.string().min(1),
      })
      .strict(),
    source: z.union([z.literal("dashboard"), z.literal("webhook")]),
  })
  .strict();

export const InternalSandboxRuntimeStartProfileInstanceResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();
