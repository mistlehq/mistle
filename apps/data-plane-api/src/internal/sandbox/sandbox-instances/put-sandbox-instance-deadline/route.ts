import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  PutSandboxInstanceDeadlineAcceptedResponseSchema,
  PutSandboxInstanceDeadlineBodySchema,
  PutSandboxInstanceDeadlineParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/instances/:id/deadlines/:kind",
  tags: ["Internal"],
  request: {
    params: PutSandboxInstanceDeadlineParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PutSandboxInstanceDeadlineBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Create or replace a sandbox instance deadline for internal callers.",
      content: {
        "application/json": {
          schema: PutSandboxInstanceDeadlineAcceptedResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid deadline request.",
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
