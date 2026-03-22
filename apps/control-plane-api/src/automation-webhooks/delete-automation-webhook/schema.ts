import { z } from "@hono/zod-openapi";

import {
  AutomationWebhookParamsSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
} from "../schemas.js";

export {
  AutomationWebhookParamsSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
};

export const DeleteAutomationWebhookResponseSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict();
