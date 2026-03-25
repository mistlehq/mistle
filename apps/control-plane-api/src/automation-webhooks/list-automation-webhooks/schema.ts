import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";

import { AutomationWebhooksBadRequestCodes } from "../constants.js";
import { AutomationWebhookListItemSchema } from "../schemas.js";

export const ListAutomationWebhooksResponseSchema = createKeysetPaginationEnvelopeSchema(
  AutomationWebhookListItemSchema,
  {
    maxLimit: 100,
  },
);

const ListAutomationWebhooksBadRequestCodeSchema = z.enum([
  AutomationWebhooksBadRequestCodes.INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT,
  AutomationWebhooksBadRequestCodes.INVALID_PAGINATION_CURSOR,
]);

export const ListAutomationWebhooksDomainBadRequestResponseSchema = createCodeMessageErrorSchema(
  ListAutomationWebhooksBadRequestCodeSchema,
);

export const ListAutomationWebhooksBadRequestResponseSchema = z.union([
  ListAutomationWebhooksDomainBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
