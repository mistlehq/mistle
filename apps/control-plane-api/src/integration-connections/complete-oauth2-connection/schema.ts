import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";

export const CompleteOAuth2ConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const CompleteOAuth2ConnectionQuerySchema = z
  .object({
    state: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
    error_uri: z.string().min(1).optional(),
  })
  .catchall(z.string());

export const CompleteOAuth2ConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_COMPLETE_INPUT,
      IntegrationConnectionsBadRequestCodes.OAUTH2_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.OAUTH2_CAPABILITY_NOT_CONFIGURED,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);
