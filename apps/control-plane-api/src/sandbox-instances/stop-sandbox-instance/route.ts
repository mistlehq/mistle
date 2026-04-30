import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { conflictResponseSchema } from "../create-sandbox-instance-connection-token/schema.js";
import {
  sandboxInstanceIdParamsSchema,
  sandboxInstancesNotFoundResponseSchema,
} from "../schemas.js";
import { stopSandboxInstanceBodySchema, stopSandboxInstanceResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/{instanceId}/stop",
  tags: ["Sandbox Instances"],
  request: {
    params: sandboxInstanceIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: stopSandboxInstanceBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Stop a sandbox instance when its purpose supports user-requested stops.",
      content: {
        "application/json": {
          schema: stopSandboxInstanceResponseSchema,
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
    409: {
      description: "Sandbox instance cannot be stopped from its current state or purpose.",
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
