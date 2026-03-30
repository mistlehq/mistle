import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  ResumeSandboxInstanceAcceptedResponseSchema,
  ResumeSandboxInstanceBodySchema,
  ResumeSandboxInstanceParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/instances/:id/resume",
  tags: ["Internal"],
  request: {
    params: ResumeSandboxInstanceParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResumeSandboxInstanceBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Queue sandbox instance resume for internal callers.",
      content: {
        "application/json": {
          schema: ResumeSandboxInstanceAcceptedResponseSchema,
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
