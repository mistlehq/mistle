import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { CreatedIntegrationWebhookSourceSchema } from "../schemas.js";

export const CreateIntegrationWebhookSourceParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const CreateIntegrationWebhookSourceBodySchema = z
  .object({
    displayName: z.string().min(1).optional(),
  })
  .strict();

export const CreateIntegrationWebhookSourceResponseSchema = CreatedIntegrationWebhookSourceSchema;

export const CreateIntegrationWebhookSourceBadRequestResponseSchema = z.union([
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

export const CreateIntegrationWebhookSourceNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
