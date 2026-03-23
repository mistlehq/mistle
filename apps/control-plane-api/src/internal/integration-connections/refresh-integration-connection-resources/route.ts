import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";
import { z } from "zod";

import {
  InternalRefreshIntegrationConnectionResourcesBadRequestResponseSchema,
  InternalRefreshIntegrationConnectionResourcesNotFoundResponseSchema,
  InternalRefreshIntegrationConnectionResourcesRequestSchema,
  InternalRefreshIntegrationConnectionResourcesResponseSchema,
} from "./schema.js";

export const route = createRoute({
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
          schema: InternalRefreshIntegrationConnectionResourcesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid refresh request.",
      content: {
        "application/json": {
          schema: InternalRefreshIntegrationConnectionResourcesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    404: {
      description: "Referenced integration connection was not found.",
      content: {
        "application/json": {
          schema: InternalRefreshIntegrationConnectionResourcesNotFoundResponseSchema,
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
