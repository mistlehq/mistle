import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  AutomationWebhookSchema,
  CreateAutomationWebhookBadRequestResponseSchema,
  CreateAutomationWebhookBodySchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Automations"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateAutomationWebhookBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a webhook automation.",
      content: {
        "application/json": {
          schema: AutomationWebhookSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CreateAutomationWebhookBadRequestResponseSchema,
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
