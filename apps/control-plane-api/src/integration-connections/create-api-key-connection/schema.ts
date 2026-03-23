import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";

export const CreateApiKeyConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const CreateApiKeyConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
    apiKey: z.string().min(1),
  })
  .strict();

export const CreateApiKeyConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.API_KEY_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);
