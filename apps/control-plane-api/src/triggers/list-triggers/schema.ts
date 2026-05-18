import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";

import { TriggersBadRequestCodes } from "../constants.js";
import { TriggerListItemSchema } from "../schemas.js";

export const ListTriggersResponseSchema = createKeysetPaginationEnvelopeSchema(
  TriggerListItemSchema,
  {
    maxLimit: 100,
  },
);

const ListTriggersBadRequestCodeSchema = z.enum([
  TriggersBadRequestCodes.INVALID_LIST_TRIGGERS_INPUT,
  TriggersBadRequestCodes.INVALID_PAGINATION_CURSOR,
]);

export const ListTriggersDomainBadRequestResponseSchema = createCodeMessageErrorSchema(
  ListTriggersBadRequestCodeSchema,
);

export const ListTriggersBadRequestResponseSchema = z.union([
  ListTriggersDomainBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
