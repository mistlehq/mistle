import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const StartProviderAppSetupParamsSchema = z
  .object({
    connectionId: z.string().min(1),
    routeSegment: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  })
  .strict();

export const StartProviderAppSetupBodySchema = z.record(z.string(), z.unknown());

export const StartedProviderAppSetupResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("form-post"),
      submissionUrl: z.url(),
      fields: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("redirect"),
      authorizationUrl: z.url(),
    })
    .strict(),
]);

export const StartProviderAppSetupBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.PROVIDER_APP_SETUP_CONNECTION_METHOD_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_START_INPUT,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const StartProviderAppSetupNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
