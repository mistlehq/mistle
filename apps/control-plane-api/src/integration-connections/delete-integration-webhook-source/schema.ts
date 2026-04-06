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

export const DeleteIntegrationWebhookSourceParamsSchema = z
  .object({
    connectionId: z.string().min(1),
    webhookSourceId: z.string().min(1),
  })
  .strict();

export const DeleteIntegrationWebhookSourceBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_WEBHOOK_SOURCE_INPUT,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_CONNECTION_SCOPE_REQUIRED,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_MANAGED_LIFECYCLE_REQUIRED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const DeleteIntegrationWebhookSourceNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
    IntegrationConnectionsNotFoundCodes.WEBHOOK_SOURCE_NOT_FOUND,
  ]),
);

export const DeleteIntegrationWebhookSourceConflictResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsConflictCodes.WEBHOOK_SOURCE_HAS_AUTOMATIONS),
);
