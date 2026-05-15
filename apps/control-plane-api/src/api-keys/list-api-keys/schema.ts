import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

import { ApiKeysBadRequestCodes } from "../constants.js";
import { ApiKeySchema } from "../schemas.js";

export const ListApiKeysQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

export const ListApiKeysResponseSchema = createKeysetPaginationEnvelopeSchema(ApiKeySchema, {
  maxLimit: 100,
});

export const ListApiKeysDomainBadRequestResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    ApiKeysBadRequestCodes.INVALID_LIST_API_KEYS_INPUT,
    ApiKeysBadRequestCodes.INVALID_PAGINATION_CURSOR,
  ]),
);

export const ListApiKeysBadRequestResponseSchema = z.union([
  ListApiKeysDomainBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
