import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  sandboxInstanceIdParamsSchema,
  sandboxInstancesNotFoundResponseSchema,
} from "../schemas.js";
import { deleteSandboxInstanceResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/{instanceId}",
  tags: ["Sandbox Instances"],
  request: {
    params: sandboxInstanceIdParamsSchema,
  },
  responses: {
    200: {
      description: "Delete a sandbox session from ordinary user-visible surfaces.",
      content: {
        "application/json": {
          schema: deleteSandboxInstanceResponseSchema,
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
      description: "Active organization is required.",
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
