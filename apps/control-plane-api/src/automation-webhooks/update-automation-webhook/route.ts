import { createRoute } from "@hono/zod-openapi";

import {
  AutomationWebhookParamsSchema,
  AutomationWebhookSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
  UpdateAutomationWebhookBadRequestResponseSchema,
  UpdateAutomationWebhookBodySchema,
} from "./schema.js";

export const route = createRoute({
  method: "patch",
  path: "/{automationId}",
  tags: ["Automations"],
  request: {
    params: AutomationWebhookParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateAutomationWebhookBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update a webhook automation.",
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
          schema: UpdateAutomationWebhookBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Webhook automation was not found.",
      content: {
        "application/json": {
          schema: AutomationWebhooksNotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksForbiddenResponseSchema,
        },
      },
    },
  },
});
