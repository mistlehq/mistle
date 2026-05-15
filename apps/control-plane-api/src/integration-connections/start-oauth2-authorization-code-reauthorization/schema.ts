import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { StartOAuth2AuthorizationCodeConnectionResponseSchema } from "../start-oauth2-authorization-code-connection/schema.js";

export const StartOAuth2AuthorizationCodeConnectionReauthorizationParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const StartOAuth2AuthorizationCodeConnectionReauthorizationResponseSchema =
  StartOAuth2AuthorizationCodeConnectionResponseSchema;

export const StartOAuth2AuthorizationCodeConnectionReauthorizationBadRequestResponseSchema =
  z.union([
    createCodeMessageErrorSchema(
      z.enum([
        IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
        IntegrationConnectionsBadRequestCodes.OAUTH2_NOT_SUPPORTED,
        IntegrationConnectionsBadRequestCodes.OAUTH2_CAPABILITY_NOT_CONFIGURED,
      ]),
    ),
    ValidationErrorResponseSchema,
  ]);

export const StartOAuth2AuthorizationCodeConnectionReauthorizationConflictResponseSchema =
  createCodeMessageErrorSchema(
    z.literal(IntegrationConnectionsConflictCodes.CONNECTION_USED_BY_IDENTITY_LINKING),
  );

export const StartOAuth2AuthorizationCodeConnectionReauthorizationNotFoundResponseSchema =
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
    ]),
  );
