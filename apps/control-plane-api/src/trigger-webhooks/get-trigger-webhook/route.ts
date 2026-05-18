import { createRoute } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerWebhookParamsSchema, TriggerWebhookSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/{triggerId}",
  tags: ["Triggers"],
  request: {
    params: TriggerWebhookParamsSchema,
  },
  responses: {
    200: {
      description: "Get a webhook trigger.",
      content: {
        "application/json": {
          schema: TriggerWebhookSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Webhook trigger was not found.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
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
  },
});
