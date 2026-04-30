import { z } from "@hono/zod-openapi";

export const InternalSandboxRuntimeStartProfileInstanceRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    profileId: z.string().min(1),
    profileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable().optional(),
    startedBy: z
      .object({
        kind: z.union([z.literal("user"), z.literal("system")]),
        id: z.string().min(1),
      })
      .strict(),
    actingUser: z
      .object({ userId: z.string().min(1) })
      .strict()
      .optional(),
    source: z.union([z.literal("dashboard"), z.literal("webhook"), z.literal("schedule")]),
  })
  .strict();

export const InternalSandboxRuntimeStartProfileInstanceResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();
