import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  RefreshAllIntegrationConnectionResourcesBadRequestResponseSchema,
  RefreshAllIntegrationConnectionResourcesNotFoundResponseSchema,
  RefreshAllIntegrationConnectionResourcesParamsSchema,
  RefreshAllIntegrationConnectionResourcesResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/resources/refresh",
  tags: ["Integrations"],
  request: {
    params: RefreshAllIntegrationConnectionResourcesParamsSchema,
  },
  responses: {
    202: {
      description: "Enqueue resource syncs for every resource kind on an integration connection.",
      content: {
        "application/json": {
          schema: RefreshAllIntegrationConnectionResourcesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: RefreshAllIntegrationConnectionResourcesBadRequestResponseSchema,
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
          schema: RefreshAllIntegrationConnectionResourcesNotFoundResponseSchema,
        },
      },
    },
  },
});
