import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { ProtectedIntegrationConnectionsRouteMiddleware } from "../middleware.js";
import {
  ListIntegrationConnectionsBadRequestResponseSchema,
  ListIntegrationConnectionsQuerySchema,
  ListIntegrationConnectionsResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Integrations"],
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
  request: {
    query: ListIntegrationConnectionsQuerySchema,
  },
  responses: {
    200: {
      description: "List integration connections for the authenticated organization.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionsBadRequestResponseSchema,
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
