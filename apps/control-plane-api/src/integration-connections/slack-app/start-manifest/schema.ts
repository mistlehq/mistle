import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../constants.js";

export const StartSlackAppManifestConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const StartSlackAppManifestConnectionBodySchema = z
  .object({
    appConfigToken: z.string().trim().min(1),
    manifest: z.record(z.string(), z.unknown()),
  })
  .strict();

export const StartSlackAppManifestConnectionResponseSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

export const StartSlackAppManifestConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
      IntegrationConnectionsBadRequestCodes.SLACK_APP_MANIFEST_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const StartSlackAppManifestConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
