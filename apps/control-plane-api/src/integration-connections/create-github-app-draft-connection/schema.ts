import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const CreateGitHubAppDraftConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const CreateGitHubAppDraftConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
  })
  .strict();

export const CreateGitHubAppDraftConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const CreateGitHubAppDraftConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND),
);
