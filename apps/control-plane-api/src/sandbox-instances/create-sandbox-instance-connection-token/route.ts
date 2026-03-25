import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  sandboxInstanceConnectionTokenSchema,
  sandboxInstanceIdParamsSchema,
  sandboxInstancesNotFoundResponseSchema,
} from "../schemas.js";
import { conflictResponseSchema } from "./schema.js";

const bodySchema = z.object({}).strict();

export const route = createRoute({
  method: "post",
  path: "/{instanceId}/connection-tokens",
  tags: ["Sandbox Instances"],
  request: {
    params: sandboxInstanceIdParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: bodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Issue a short-lived connection token for a running sandbox instance.",
      content: {
        "application/json": {
          schema: sandboxInstanceConnectionTokenSchema,
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
