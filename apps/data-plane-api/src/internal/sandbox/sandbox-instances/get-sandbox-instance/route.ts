import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { GetSandboxInstanceResponseSchema } from "../../../sandbox-instances/schemas.js";
import { GetSandboxInstanceParamsSchema, GetSandboxInstanceQuerySchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/instances/:id",
  tags: ["Internal"],
  request: {
    params: GetSandboxInstanceParamsSchema,
    query: GetSandboxInstanceQuerySchema,
  },
  responses: {
    200: {
      description: "Get sandbox instance status for internal callers.",
      content: {
        "application/json": {
          schema: GetSandboxInstanceResponseSchema,
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
