import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";

export const StartGitHubAppInstallationConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const StartGitHubAppInstallationConnectionBodySchema = z
  .object({
    displayName: z.string().min(1).optional(),
  })
  .strict();

export const StartGitHubAppInstallationConnectionResponseSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

export const StartGitHubAppInstallationConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_HANDLER_NOT_CONFIGURED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);
