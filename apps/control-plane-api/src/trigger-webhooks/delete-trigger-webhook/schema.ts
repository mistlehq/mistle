import { z } from "@hono/zod-openapi";

export const DeleteTriggerWebhookResponseSchema = z
  .object({
    triggerId: z.string().min(1),
  })
  .strict();
