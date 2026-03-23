import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";

export const UpdateApiKeyConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const UpdateApiKeyConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
    apiKey: z
      .string()
      .min(1)
      .regex(/\S/, "`apiKey` must contain at least one non-whitespace character when provided."),
  })
  .strict();

export const UpdateApiKeyConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.API_KEY_CONNECTION_REQUIRED,
      IntegrationConnectionsBadRequestCodes.API_KEY_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);
