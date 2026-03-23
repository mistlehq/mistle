import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { notFoundResponseSchema } from "../get-sandbox-profile/schema.js";
import {
  sandboxProfileIdParamsSchema,
  sandboxProfileSchema,
  updateSandboxProfileBodySchema,
} from "../schemas.js";

export const route = createRoute({
  method: "patch",
  path: "/{profileId}",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: updateSandboxProfileBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update a sandbox profile.",
      content: {
        "application/json": {
          schema: sandboxProfileSchema,
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
    404: {
      description: "Sandbox profile was not found.",
      content: {
        "application/json": {
          schema: notFoundResponseSchema,
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
