import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";

import { AutomationsBadRequestCodes } from "../constants.js";
import { AutomationListItemSchema } from "../schemas.js";

export const ListAutomationsResponseSchema = createKeysetPaginationEnvelopeSchema(
  AutomationListItemSchema,
  {
    maxLimit: 100,
  },
);

const ListAutomationsBadRequestCodeSchema = z.enum([
  AutomationsBadRequestCodes.INVALID_LIST_AUTOMATIONS_INPUT,
  AutomationsBadRequestCodes.INVALID_PAGINATION_CURSOR,
]);

export const ListAutomationsDomainBadRequestResponseSchema = createCodeMessageErrorSchema(
  ListAutomationsBadRequestCodeSchema,
);

export const ListAutomationsBadRequestResponseSchema = z.union([
  ListAutomationsDomainBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
