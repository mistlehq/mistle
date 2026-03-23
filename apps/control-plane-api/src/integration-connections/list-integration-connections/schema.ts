import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import { IntegrationConnectionSchema } from "../schemas.js";

export const ListIntegrationConnectionsQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

export const ListIntegrationConnectionsResponseSchema = createKeysetPaginationEnvelopeSchema(
  IntegrationConnectionSchema,
  {
    maxLimit: 100,
  },
);

export const ListIntegrationConnectionsDomainBadRequestResponseSchema =
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTIONS_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_PAGINATION_CURSOR,
    ]),
  );

export const ListIntegrationConnectionsBadRequestResponseSchema = z.union([
  ListIntegrationConnectionsDomainBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
