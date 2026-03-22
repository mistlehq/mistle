import { z } from "@hono/zod-openapi";

import { AutomationWebhookParamsSchema } from "../schemas.js";

export { AutomationWebhookParamsSchema };

export const DeleteAutomationWebhookResponseSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict();
