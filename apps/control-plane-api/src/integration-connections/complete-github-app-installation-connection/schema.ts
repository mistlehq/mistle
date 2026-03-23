import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const CompleteGitHubAppInstallationConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const CompleteGitHubAppInstallationConnectionQuerySchema = z
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

export const CompleteGitHubAppInstallationConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_HANDLER_NOT_CONFIGURED,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const CompleteGitHubAppInstallationConnectionNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal(IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND));
