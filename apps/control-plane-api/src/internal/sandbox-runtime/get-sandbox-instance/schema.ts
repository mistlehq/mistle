import { z } from "@hono/zod-openapi";

export const InternalSandboxRuntimeGetSandboxInstanceRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

export const InternalSandboxRuntimeGetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["pending", "starting", "running", "stopped", "failed"]),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();
