import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import {
  IntegrationWebhooksBadRequestCodes,
  IntegrationWebhooksNotFoundCodes,
} from "../constants.js";

export const paramsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const badRequestResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationWebhooksBadRequestCodes.INVALID_WEBHOOK_REQUEST),
);

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IntegrationWebhooksNotFoundCodes.TARGET_NOT_FOUND,
    IntegrationWebhooksNotFoundCodes.CONNECTION_NOT_FOUND,
  ]),
);
