import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  ListSandboxOperationEventsParamsSchema,
  ListSandboxOperationEventsQuerySchema,
} from "../../../sandbox-instances/list-sandbox-operation-events/schema.js";
import { SandboxOperationEventsResponseSchema } from "../../../sandbox-instances/schemas.js";

export const route = createRoute({
  method: "get",
  path: "/instances/:id/operation-events",
  tags: ["Internal"],
  request: {
    params: ListSandboxOperationEventsParamsSchema,
    query: ListSandboxOperationEventsQuerySchema,
  },
  responses: {
    200: {
      description: "List persisted sandbox operation events for internal callers.",
      content: {
        "application/json": {
          schema: SandboxOperationEventsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
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
