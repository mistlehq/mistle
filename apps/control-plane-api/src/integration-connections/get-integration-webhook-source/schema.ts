import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { IntegrationWebhookSourceSchema } from "../schemas.js";

export const GetIntegrationWebhookSourceParamsSchema = z
  .object({
    connectionId: z.string().min(1),
    webhookSourceId: z.string().min(1),
  })
  .strict();

export const GetIntegrationWebhookSourceResponseSchema = IntegrationWebhookSourceSchema;

export const GetIntegrationWebhookSourceBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_WEBHOOK_SOURCE_INPUT,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const GetIntegrationWebhookSourceNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
    IntegrationConnectionsNotFoundCodes.WEBHOOK_SOURCE_NOT_FOUND,
  ]),
);
