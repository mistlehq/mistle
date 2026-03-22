import { z } from "@hono/zod-openapi";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";

import {
  AutomationWebhookSchema,
  AutomationWebhooksBadRequestResponseSchema,
  ValidationErrorResponseSchema,
} from "../schemas.js";
import { ListWebhookAutomationsQuerySchema } from "./service.js";

export { ListWebhookAutomationsQuerySchema };

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
