import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  ListIntegrationWebhookSourcesBadRequestResponseSchema,
  ListIntegrationWebhookSourcesNotFoundResponseSchema,
  ListIntegrationWebhookSourcesParamsSchema,
  ListIntegrationWebhookSourcesResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/:connectionId/webhook-sources",
  tags: ["Integrations"],
  request: {
    params: ListIntegrationWebhookSourcesParamsSchema,
  },
  responses: {
    200: {
      description: "List webhook sources accessible for an integration connection.",
      content: {
        "application/json": {
          schema: ListIntegrationWebhookSourcesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIntegrationWebhookSourcesBadRequestResponseSchema,
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
          schema: ListIntegrationWebhookSourcesNotFoundResponseSchema,
        },
      },
    },
  },
});
