import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  listSkillsSourceReposQuerySchema,
  listSkillsSourceReposResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";
import { notFoundResponseSchema } from "../start-sandbox-profile-instance/schema.js";

export const route = createRoute({
  method: "get",
  path: "/{profileId}/versions/{version}/skills-sources",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    query: listSkillsSourceReposQuerySchema,
  },
  responses: {
    200: {
      description: "List synced skills sources for a sandbox profile version.",
      content: {
        "application/json": {
          schema: listSkillsSourceReposResponseSchema,
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
      description: "Sandbox profile or profile version was not found.",
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
