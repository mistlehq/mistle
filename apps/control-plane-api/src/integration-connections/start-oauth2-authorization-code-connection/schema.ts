import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const StartOAuth2AuthorizationCodeConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const StartOAuth2AuthorizationCodeConnectionBodySchema = z
  .object({
    displayName: z.string().min(1).optional(),
  })
  .strict();

export const StartOAuth2AuthorizationCodeConnectionResponseSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

export const StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
      IntegrationConnectionsBadRequestCodes.OAUTH2_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.OAUTH2_CAPABILITY_NOT_CONFIGURED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const StartOAuth2AuthorizationCodeConnectionNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal(IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND));
