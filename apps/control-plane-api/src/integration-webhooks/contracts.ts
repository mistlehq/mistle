import { createRoute, z } from "@hono/zod-openapi";

import {
  IntegrationWebhooksBadRequestCodes,
  IntegrationWebhooksNotFoundCodes,
} from "./services/errors.js";

export const IngestIntegrationWebhookParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const IngestIntegrationWebhookResponseSchema = z
  .object({
    status: z.enum(["received", "duplicate"]),
  })
  .strict();

const ImmediateIntegrationWebhookBodySchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
]);

const BadRequestCodeSchema = z.enum([IntegrationWebhooksBadRequestCodes.INVALID_WEBHOOK_REQUEST]);

export const IntegrationWebhooksBadRequestResponseSchema = z
  .object({
    code: BadRequestCodeSchema,
    message: z.string().min(1),
  })
  .strict();

const NotFoundCodeSchema = z.enum([
  IntegrationWebhooksNotFoundCodes.TARGET_NOT_FOUND,
  IntegrationWebhooksNotFoundCodes.CONNECTION_NOT_FOUND,
]);

export const IntegrationWebhooksNotFoundResponseSchema = z
  .object({
    code: NotFoundCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const ingestIntegrationWebhookRoute = createRoute({
  method: "post",
  path: "/:targetKey",
  tags: ["Integrations"],
  request: {
    params: IngestIntegrationWebhookParamsSchema,
  },
  responses: {
    "2XX": {
      description:
        "Immediate integration-defined webhook response. Status code, headers, content type, and body are integration-specific and may include empty responses.",
      content: {
        "*/*": {
          schema: ImmediateIntegrationWebhookBodySchema,
        },
      },
    },
    204: {
      description: "Immediate integration-defined webhook response with no body.",
    },
    202: {
      description: "Webhook event accepted for processing.",
      content: {
        "application/json": {
          schema: IngestIntegrationWebhookResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid webhook request.",
      content: {
        "application/json": {
          schema: IntegrationWebhooksBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Integration target or connection was not found.",
      content: {
        "application/json": {
          schema: IntegrationWebhooksNotFoundResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
        },
      },
    },
  },
});
