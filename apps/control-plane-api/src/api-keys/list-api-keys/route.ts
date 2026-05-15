import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  ListApiKeysBadRequestResponseSchema,
  ListApiKeysQuerySchema,
  ListApiKeysResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["API Keys"],
  request: {
    query: ListApiKeysQuerySchema,
  },
  responses: {
    200: {
      description: "List active API keys for the authenticated organization.",
      content: {
        "application/json": {
          schema: ListApiKeysResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListApiKeysBadRequestResponseSchema,
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
      description: "API key read permission is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
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
