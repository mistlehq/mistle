import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { ProtectedIntegrationConnectionsRouteMiddleware } from "../middleware.js";
import { IntegrationConnectionsNotFoundResponseSchema } from "../schemas.js";
import {
  RefreshIntegrationConnectionResourcesBadRequestResponseSchema,
  RefreshIntegrationConnectionResourcesParamsSchema,
  RefreshIntegrationConnectionResourcesResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/resources/:kind/refresh",
  tags: ["Integrations"],
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
  request: {
    params: RefreshIntegrationConnectionResourcesParamsSchema,
  },
  responses: {
    202: {
      description: "Enqueue a resource sync for an integration connection resource kind.",
      content: {
        "application/json": {
          schema: RefreshIntegrationConnectionResourcesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: RefreshIntegrationConnectionResourcesBadRequestResponseSchema,
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
          schema: IntegrationConnectionsNotFoundResponseSchema,
        },
      },
    },
  },
});
