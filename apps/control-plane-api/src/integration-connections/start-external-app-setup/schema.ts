import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const StartExternalAppSetupParamsSchema = z
  .object({
    connectionId: z.string().min(1),
    routeSegment: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  })
  .strict();

export const StartExternalAppSetupBodySchema = z.record(z.string(), z.unknown());

export const StartedExternalAppSetupResponseSchema = z.discriminatedUnion("kind", [
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

export const StartExternalAppSetupBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const StartExternalAppSetupNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
