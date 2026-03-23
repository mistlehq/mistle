import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  ListIntegrationTargetsBadRequestResponseSchema,
  ListIntegrationTargetsQuerySchema,
  ListIntegrationTargetsResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Integrations"],
  request: {
    query: ListIntegrationTargetsQuerySchema,
  },
  responses: {
    200: {
      description: "List effective integration targets from control-plane storage.",
      content: {
        "application/json": {
          schema: ListIntegrationTargetsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIntegrationTargetsBadRequestResponseSchema,
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
