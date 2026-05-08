import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  RefreshWebhookTriggerCapabilitiesBadRequestResponseSchema,
  RefreshWebhookTriggerCapabilitiesBodySchema,
  RefreshWebhookTriggerCapabilitiesNotFoundResponseSchema,
  RefreshWebhookTriggerCapabilitiesParamsSchema,
  RefreshWebhookTriggerCapabilitiesResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/webhook-sources/trigger-capabilities/refresh",
  tags: ["Integrations"],
  request: {
    params: RefreshWebhookTriggerCapabilitiesParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: RefreshWebhookTriggerCapabilitiesBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Refresh verified webhook trigger capabilities for an integration connection.",
      content: {
        "application/json": {
          schema: RefreshWebhookTriggerCapabilitiesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: RefreshWebhookTriggerCapabilitiesBadRequestResponseSchema,
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
          schema: RefreshWebhookTriggerCapabilitiesNotFoundResponseSchema,
        },
      },
    },
  },
});
