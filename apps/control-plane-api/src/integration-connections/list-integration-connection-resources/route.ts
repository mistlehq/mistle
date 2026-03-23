import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  ListIntegrationConnectionResourcesConflictResponseSchema,
  ListIntegrationConnectionResourcesBadRequestResponseSchema,
  ListIntegrationConnectionResourcesNotFoundResponseSchema,
  ListIntegrationConnectionResourcesParamsSchema,
  ListIntegrationConnectionResourcesQuerySchema,
  ListIntegrationConnectionResourcesResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/:connectionId/resources",
  tags: ["Integrations"],
  request: {
    params: ListIntegrationConnectionResourcesParamsSchema,
    query: ListIntegrationConnectionResourcesQuerySchema,
  },
  responses: {
    200: {
      description: "List resources exposed by an integration connection for a resource kind.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionResourcesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionResourcesBadRequestResponseSchema,
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
          schema: ListIntegrationConnectionResourcesNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Resource listing requires a usable resource snapshot.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionResourcesConflictResponseSchema,
        },
      },
    },
  },
});
