import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../../integration-connections/constants.js";

export const CompleteSlackAppInstallationQuerySchema = z
  .object({
    code: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
  })
  .catchall(z.string());

export const CompleteSlackAppInstallationBadRequestResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
    IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
    IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
  ]),
);

export const CompleteSlackAppInstallationNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
