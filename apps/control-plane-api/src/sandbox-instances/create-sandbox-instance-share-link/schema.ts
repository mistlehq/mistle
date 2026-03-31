import { z } from "@hono/zod-openapi";

export const bodySchema = z
  .object({
    expiresInSeconds: z.number().int().min(1).optional(),
  })
  .strict();
