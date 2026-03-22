import { z } from "@hono/zod-openapi";

import {
  AutomationWebhookParamsSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
} from "../shared-schemas.js";

export {
  AutomationWebhookParamsSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
};

export const DeleteAutomationWebhookResponseSchema = z
  .object({
    status: z.literal("deleted"),
    automationId: z.string().min(1),
  })
  .strict();
