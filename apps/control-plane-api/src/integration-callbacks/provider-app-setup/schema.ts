import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../integration-connections/constants.js";

export const CompleteProviderAppSetupCallbackParamsSchema = z
  .object({
    callbackRouteKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  })
  .strict();

export const CompleteProviderAppSetupCallbackQuerySchema = z
  .object({
    state: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
    error_uri: z.string().min(1).optional(),
    installation_id: z.string().min(1).optional(),
    setup_action: z.string().min(1).optional(),
  })
  .catchall(z.string());

export const CompleteProviderAppSetupCallbackBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const CompleteProviderAppSetupCallbackNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
