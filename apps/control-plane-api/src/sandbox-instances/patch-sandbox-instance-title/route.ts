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
import {
  patchSandboxInstanceTitleBodySchema,
  patchSandboxInstanceTitleResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "patch",
  path: "/{instanceId}/title",
  tags: ["Sandbox Instances"],
  request: {
    params: sandboxInstanceIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: patchSandboxInstanceTitleBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Patch the persisted sandbox instance title.",
      content: {
        "application/json": {
          schema: patchSandboxInstanceTitleResponseSchema,
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
