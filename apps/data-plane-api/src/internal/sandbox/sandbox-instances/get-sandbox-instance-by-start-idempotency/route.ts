import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  GetSandboxInstanceByStartIdempotencyQuerySchema,
  GetSandboxInstanceByStartIdempotencyResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/instances/start-idempotency",
  tags: ["Internal"],
  request: {
    query: GetSandboxInstanceByStartIdempotencyQuerySchema,
  },
  responses: {
    200: {
      description: "Find a sandbox instance start by idempotency key for internal callers.",
      content: {
        "application/json": {
          schema: GetSandboxInstanceByStartIdempotencyResponseSchema,
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
