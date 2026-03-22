import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  ListAutomationWebhooksBadRequestResponseSchema,
  ListAutomationWebhooksResponseSchema,
  ListWebhookAutomationsQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Automations"],
  request: {
    query: ListWebhookAutomationsQuerySchema,
  },
  responses: {
    200: {
      description: "List webhook automations for the active organization.",
      content: {
        "application/json": {
          schema: ListAutomationWebhooksResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListAutomationWebhooksBadRequestResponseSchema,
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
