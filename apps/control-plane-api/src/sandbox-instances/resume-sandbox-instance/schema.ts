import { z } from "@hono/zod-openapi";

export const resumeSandboxInstanceBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();
