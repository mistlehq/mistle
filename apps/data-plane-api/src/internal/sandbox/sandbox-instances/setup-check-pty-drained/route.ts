import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  SetupCheckPtyDrainedBodySchema,
  SetupCheckPtyDrainedParamsSchema,
  SetupCheckPtyDrainedResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/instances/:id/setup-check-pty-drained",
  tags: ["Internal"],
  request: {
    params: SetupCheckPtyDrainedParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SetupCheckPtyDrainedBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Handle a drained setup-check PTY event for internal callers.",
      content: {
        "application/json": {
          schema: SetupCheckPtyDrainedResponseSchema,
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
