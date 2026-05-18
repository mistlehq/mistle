import { createRoute } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerWebhookParamsSchema, TriggerWebhookSchema } from "../schemas.js";
import {
  UpdateTriggerWebhookBadRequestResponseSchema,
  UpdateTriggerWebhookBodySchema,
} from "./schema.js";

export const route = createRoute({
  method: "patch",
  path: "/{triggerId}",
  tags: ["Triggers"],
  request: {
    params: TriggerWebhookParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateTriggerWebhookBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update a webhook trigger.",
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
          schema: UpdateTriggerWebhookBadRequestResponseSchema,
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
