import { createRoute, z } from "@hono/zod-openapi";

import {
  RefreshIntegrationConnectionResourcesBadRequestResponseSchema,
  RefreshIntegrationConnectionResourcesNotFoundResponseSchema,
  RefreshIntegrationConnectionResourcesResponseSchema,
} from "../integration-connections/refresh-integration-connection-resources/schema.js";

export const InternalIntegrationConnectionsErrorResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const InternalIntegrationConnectionsBadRequestResponseSchema =
  RefreshIntegrationConnectionResourcesBadRequestResponseSchema;

export const InternalRefreshIntegrationConnectionResourcesRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    connectionId: z.string().min(1),
    kind: z.string().min(1),
  })
  .strict();

export const internalRefreshIntegrationConnectionResourcesRoute = createRoute({
  method: "post",
  path: "/refresh-resource",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: InternalRefreshIntegrationConnectionResourcesRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Request integration connection resource refresh for internal callers.",
      content: {
        "application/json": {
          schema: RefreshIntegrationConnectionResourcesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid refresh request.",
      content: {
        "application/json": {
          schema: InternalIntegrationConnectionsBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalIntegrationConnectionsErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Referenced integration connection was not found.",
      content: {
        "application/json": {
          schema: RefreshIntegrationConnectionResourcesNotFoundResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
        },
      },
    },
  },
});
