import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  sandboxInstancePortParamsSchema,
  sandboxInstanceShareLinkSchema,
  sandboxInstancesNotFoundResponseSchema,
} from "../schemas.js";
import { bodySchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/{instanceId}/ports/{port}/share",
  tags: ["Sandbox Instances"],
  request: {
    params: sandboxInstancePortParamsSchema,
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
      description: "Create a short-lived share link for one sandbox port.",
      content: {
        "application/json": {
          schema: sandboxInstanceShareLinkSchema,
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
