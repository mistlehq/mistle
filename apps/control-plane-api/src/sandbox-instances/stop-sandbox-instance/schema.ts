import { z } from "@hono/zod-openapi";

export const stopSandboxInstanceBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export const stopSandboxInstanceResponseSchema = z
  .object({
    status: z.enum(["accepted", "already_stopped", "already_terminal"]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();
