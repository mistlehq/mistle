import { createRoute } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerWebhookParamsSchema } from "../schemas.js";
import { DeleteTriggerWebhookResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/{triggerId}",
  tags: ["Triggers"],
  request: {
    params: TriggerWebhookParamsSchema,
  },
  responses: {
    200: {
      description: "Delete a webhook trigger.",
      content: {
        "application/json": {
          schema: DeleteTriggerWebhookResponseSchema,
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
