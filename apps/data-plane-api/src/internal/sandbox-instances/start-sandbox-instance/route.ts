import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  StartSandboxInstanceAcceptedResponseSchema,
  StartSandboxInstanceInputSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/start",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartSandboxInstanceInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Queue sandbox instance startup for internal callers.",
      content: {
        "application/json": {
          schema: StartSandboxInstanceAcceptedResponseSchema,
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
