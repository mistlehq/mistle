import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { GetSandboxInstanceResponseSchema } from "../schemas.js";
import { GetSandboxInstanceInputSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/get",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: GetSandboxInstanceInputSchema,
        },
      },
    },
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
      description: "Invalid request body.",
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
