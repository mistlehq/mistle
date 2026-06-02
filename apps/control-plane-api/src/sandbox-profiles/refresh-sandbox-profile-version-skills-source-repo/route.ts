import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  refreshSkillsSourceRepoBodySchema,
  refreshSkillsSourceRepoResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";
import {
  badRequestResponseSchema,
  conflictResponseSchema,
  notFoundResponseSchema,
} from "../start-sandbox-profile-instance/schema.js";

export const route = createRoute({
  method: "post",
  path: "/{profileId}/versions/{version}/skills-sources/refresh",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: refreshSkillsSourceRepoBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Refresh discovered skills for a sandbox profile version skills source.",
      content: {
        "application/json": {
          schema: refreshSkillsSourceRepoResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: badRequestResponseSchema,
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
    409: {
      description: "Sandbox profile version cannot refresh skills from the requested source.",
      content: {
        "application/json": {
          schema: conflictResponseSchema,
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
