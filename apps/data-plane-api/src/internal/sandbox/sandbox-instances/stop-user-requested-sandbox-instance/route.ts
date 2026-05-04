import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  StopUserRequestedSandboxInstanceBodySchema,
  StopUserRequestedSandboxInstanceConflictResponseSchema,
  StopUserRequestedSandboxInstanceParamsSchema,
  StopUserRequestedSandboxInstanceResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/instances/:id/user-stop",
  tags: ["Internal"],
  request: {
    params: StopUserRequestedSandboxInstanceParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StopUserRequestedSandboxInstanceBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Stop a sandbox instance for an internal user-requested stop.",
      content: {
        "application/json": {
          schema: StopUserRequestedSandboxInstanceResponseSchema,
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
    409: {
      description: "Sandbox instance cannot be stopped from its current state or purpose.",
      content: {
        "application/json": {
          schema: StopUserRequestedSandboxInstanceConflictResponseSchema,
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
