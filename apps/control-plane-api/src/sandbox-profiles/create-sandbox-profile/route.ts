import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { createSandboxProfileBodySchema, sandboxProfileSchema } from "../schemas.js";

export const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Sandbox Profiles"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createSandboxProfileBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a sandbox profile.",
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
