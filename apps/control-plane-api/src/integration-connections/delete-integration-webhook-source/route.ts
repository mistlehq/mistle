import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  DeleteIntegrationWebhookSourceBadRequestResponseSchema,
  DeleteIntegrationWebhookSourceConflictResponseSchema,
  DeleteIntegrationWebhookSourceNotFoundResponseSchema,
  DeleteIntegrationWebhookSourceParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/:connectionId/webhook-sources/:webhookSourceId",
  tags: ["Integrations"],
  request: {
    params: DeleteIntegrationWebhookSourceParamsSchema,
  },
  responses: {
    204: {
      description: "Delete an integration webhook source.",
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: DeleteIntegrationWebhookSourceBadRequestResponseSchema,
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
          schema: DeleteIntegrationWebhookSourceNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Webhook source is still referenced locally.",
      content: {
        "application/json": {
          schema: DeleteIntegrationWebhookSourceConflictResponseSchema,
        },
      },
    },
  },
});
