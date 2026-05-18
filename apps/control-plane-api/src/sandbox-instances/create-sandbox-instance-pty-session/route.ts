import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { conflictResponseSchema } from "../create-sandbox-instance-connection-token/schema.js";
import {
  sandboxInstanceIdParamsSchema,
  sandboxInstancePtySessionRequestSchema,
  sandboxInstancePtySessionSchema,
  sandboxInstancesNotFoundResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "post",
  path: "/{instanceId}/pty-sessions",
  tags: ["Sandbox Instances"],
  request: {
    params: sandboxInstanceIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: sandboxInstancePtySessionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Issue a short-lived client PTY transport token for a sandbox instance.",
      content: {
        "application/json": {
          schema: sandboxInstancePtySessionSchema,
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
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization or user session is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Sandbox instance was not found.",
      content: {
        "application/json": {
          schema: sandboxInstancesNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Sandbox instance is not running.",
      content: {
        "application/json": {
          schema: conflictResponseSchema,
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
