import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  DeleteSandboxInstanceQuerySchema,
  DeleteSandboxInstanceParamsSchema,
  DeleteSandboxInstanceResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/instances/:id",
  tags: ["Internal"],
  request: {
    params: DeleteSandboxInstanceParamsSchema,
    query: DeleteSandboxInstanceQuerySchema,
  },
  responses: {
    200: {
      description: "Delete a sandbox session for internal callers.",
      content: {
        "application/json": {
          schema: DeleteSandboxInstanceResponseSchema,
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
