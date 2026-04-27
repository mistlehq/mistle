import { z } from "@hono/zod-openapi";

export const InternalSandboxRuntimeResumeSandboxInstanceRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
    actingUserId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const InternalSandboxRuntimeResumeSandboxInstanceResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();
