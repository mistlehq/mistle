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

export const RefreshWebhookTriggerCapabilitiesParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const RefreshWebhookTriggerCapabilitiesBodySchema = z.record(z.string(), z.unknown());

export const RefreshWebhookTriggerCapabilitiesResponseSchema = IntegrationWebhookSourceSchema;

export const RefreshWebhookTriggerCapabilitiesBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_WEBHOOK_SOURCE_INPUT,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_TRIGGER_CAPABILITIES_REFRESH_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const RefreshWebhookTriggerCapabilitiesNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
