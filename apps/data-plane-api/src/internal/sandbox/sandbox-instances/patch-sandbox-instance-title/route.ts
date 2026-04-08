import { createRoute, z } from "@hono/zod-openapi";
import {
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  PatchSandboxInstanceTitleBodySchema,
  PatchSandboxInstanceTitleParamsSchema,
  PatchSandboxInstanceTitleResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "patch",
  path: "/instances/:id",
  tags: ["Internal"],
  request: {
    params: PatchSandboxInstanceTitleParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PatchSandboxInstanceTitleBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Patch sandbox instance title for internal callers.",
      content: {
        "application/json": {
          schema: PatchSandboxInstanceTitleResponseSchema,
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
    404: {
      description: "Sandbox instance not found.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
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
