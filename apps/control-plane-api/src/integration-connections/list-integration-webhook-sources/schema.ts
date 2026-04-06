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

export const ListIntegrationWebhookSourcesParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const ListIntegrationWebhookSourcesResponseSchema = z.array(IntegrationWebhookSourceSchema);

export const ListIntegrationWebhookSourcesBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_WEBHOOK_SOURCE_INPUT,
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const ListIntegrationWebhookSourcesNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
