import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  sandboxInstanceIdParamsSchema,
  sandboxInstanceStatusResponseSchema,
  sandboxInstancesNotFoundResponseSchema,
} from "../schemas.js";
import { resumeSandboxInstanceBodySchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/{instanceId}/resume",
  tags: ["Sandbox Instances"],
  request: {
    params: sandboxInstanceIdParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: resumeSandboxInstanceBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Start or resume an existing sandbox instance.",
      content: {
        "application/json": {
          schema: sandboxInstanceStatusResponseSchema,
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
