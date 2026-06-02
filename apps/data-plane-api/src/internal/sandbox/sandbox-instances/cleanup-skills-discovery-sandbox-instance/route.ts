import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  CleanupSkillsDiscoverySandboxInstanceBodySchema,
  CleanupSkillsDiscoverySandboxInstanceParamsSchema,
  CleanupSkillsDiscoverySandboxInstanceResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/instances/:id/cleanup-skills-discovery",
  tags: ["Internal"],
  request: {
    params: CleanupSkillsDiscoverySandboxInstanceParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CleanupSkillsDiscoverySandboxInstanceBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Clean up a one-shot skills discovery sandbox instance.",
      content: {
        "application/json": {
          schema: CleanupSkillsDiscoverySandboxInstanceResponseSchema,
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
    409: {
      description: "Skills discovery sandbox instance cannot be cleaned up from its current state.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
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
