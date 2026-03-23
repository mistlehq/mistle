import { z } from "@hono/zod-openapi";

export const DeleteAutomationWebhookResponseSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict();
