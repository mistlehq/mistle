import { z } from "@hono/zod-openapi";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";

import {
  AutomationWebhookSchema,
  AutomationWebhooksBadRequestResponseSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "../shared-schemas.js";
import { ListWebhookAutomationsQuerySchema } from "./service.js";

export { ListWebhookAutomationsQuerySchema };
export { AutomationWebhooksForbiddenResponseSchema, AutomationWebhooksUnauthorizedResponseSchema };

export const ListAutomationWebhooksResponseSchema = createKeysetPaginationEnvelopeSchema(
  AutomationWebhookSchema,
  {
    maxLimit: 100,
  },
);

export const ListAutomationWebhooksBadRequestResponseSchema = z.union([
  AutomationWebhooksBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
