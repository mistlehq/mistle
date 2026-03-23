import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

import { IntegrationTargetsBadRequestCodes } from "../constants.js";
import { IntegrationTargetSchema } from "../schemas.js";

export const ListIntegrationTargetsQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

export const ListIntegrationTargetsResponseSchema = createKeysetPaginationEnvelopeSchema(
  IntegrationTargetSchema,
  {
    maxLimit: 100,
  },
);

const ListIntegrationTargetsBadRequestCodeSchema = z.enum([
  IntegrationTargetsBadRequestCodes.INVALID_LIST_TARGETS_INPUT,
  IntegrationTargetsBadRequestCodes.INVALID_PAGINATION_CURSOR,
]);

export const ListIntegrationTargetsDomainBadRequestResponseSchema = createCodeMessageErrorSchema(
  ListIntegrationTargetsBadRequestCodeSchema,
);

export const ListIntegrationTargetsBadRequestResponseSchema = z.union([
  ListIntegrationTargetsDomainBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
