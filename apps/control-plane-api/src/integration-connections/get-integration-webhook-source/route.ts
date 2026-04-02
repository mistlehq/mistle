import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  GetIntegrationWebhookSourceBadRequestResponseSchema,
  GetIntegrationWebhookSourceNotFoundResponseSchema,
  GetIntegrationWebhookSourceParamsSchema,
  GetIntegrationWebhookSourceResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/:connectionId/webhook-sources/:webhookSourceId",
  tags: ["Integrations"],
  request: {
    params: GetIntegrationWebhookSourceParamsSchema,
  },
  responses: {
    200: {
      description: "Fetch one integration webhook source.",
      content: {
        "application/json": {
          schema: GetIntegrationWebhookSourceResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: GetIntegrationWebhookSourceBadRequestResponseSchema,
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
      description: "Connection or webhook source was not found.",
      content: {
        "application/json": {
          schema: GetIntegrationWebhookSourceNotFoundResponseSchema,
        },
      },
    },
  },
});
