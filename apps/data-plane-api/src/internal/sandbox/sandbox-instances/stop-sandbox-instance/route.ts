import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  StopSandboxInstanceAcceptedResponseSchema,
  StopSandboxInstanceBodySchema,
  StopSandboxInstanceParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/instances/:id/stop",
  tags: ["Internal"],
  request: {
    params: StopSandboxInstanceParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StopSandboxInstanceBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Queue sandbox instance stop for internal callers.",
      content: {
        "application/json": {
          schema: StopSandboxInstanceAcceptedResponseSchema,
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
