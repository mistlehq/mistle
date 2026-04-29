import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  createSandboxProfileVersionSetupCheckBodySchema,
  createSandboxProfileVersionSetupCheckResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";
import {
  conflictResponseSchema,
  createSetupCheckBadRequestResponseSchema,
  notFoundResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/{profileId}/versions/{version}/setup-checks",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createSandboxProfileVersionSetupCheckBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a setup check for the specified sandbox profile version.",
      content: {
        "application/json": {
          schema: createSandboxProfileVersionSetupCheckResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: createSetupCheckBadRequestResponseSchema,
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
      description: "Sandbox profile version is not usable.",
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
