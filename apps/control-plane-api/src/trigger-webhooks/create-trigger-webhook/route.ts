import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { TriggerWebhookSchema } from "../schemas.js";
import {
  CreateTriggerWebhookBadRequestResponseSchema,
  CreateTriggerWebhookBodySchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Triggers"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateTriggerWebhookBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a webhook trigger.",
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
          schema: CreateTriggerWebhookBadRequestResponseSchema,
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
