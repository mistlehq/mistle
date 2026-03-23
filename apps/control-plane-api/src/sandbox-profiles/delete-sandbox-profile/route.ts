import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { notFoundResponseSchema } from "../get-sandbox-profile/schema.js";
import {
  sandboxProfileDeletionAcceptedResponseSchema,
  sandboxProfileIdParamsSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "delete",
  path: "/{profileId}",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileIdParamsSchema,
  },
  responses: {
    202: {
      description:
        "Accept deletion and enqueue asynchronous sandbox profile resource cleanup workflow.",
      content: {
        "application/json": {
          schema: sandboxProfileDeletionAcceptedResponseSchema,
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
