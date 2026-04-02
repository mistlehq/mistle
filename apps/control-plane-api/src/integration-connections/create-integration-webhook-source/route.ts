import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  CreateIntegrationWebhookSourceBadRequestResponseSchema,
  CreateIntegrationWebhookSourceBodySchema,
  CreateIntegrationWebhookSourceNotFoundResponseSchema,
  CreateIntegrationWebhookSourceParamsSchema,
  CreateIntegrationWebhookSourceResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/webhook-sources",
  tags: ["Integrations"],
  request: {
    params: CreateIntegrationWebhookSourceParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateIntegrationWebhookSourceBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a managed integration webhook source.",
      content: {
        "application/json": {
          schema: CreateIntegrationWebhookSourceResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CreateIntegrationWebhookSourceBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: CreateIntegrationWebhookSourceNotFoundResponseSchema,
        },
      },
    },
  },
});
