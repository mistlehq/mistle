import { createRoute } from "@hono/zod-openapi";

import {
  AutomationWebhookParamsSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
  DeleteAutomationWebhookResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/{automationId}",
  tags: ["Automations"],
  request: {
    params: AutomationWebhookParamsSchema,
  },
  responses: {
    200: {
      description: "Delete a webhook automation.",
      content: {
        "application/json": {
          schema: DeleteAutomationWebhookResponseSchema,
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
