import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  getSandboxProfileVersionSetupCheckResponseSchema,
  sandboxProfileVersionSetupCheckParamsSchema,
} from "../schemas.js";
import { badRequestResponseSchema, notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/{profileId}/versions/{version}/setup-checks/{setupCheckId}",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionSetupCheckParamsSchema,
  },
  responses: {
    200: {
      description: "Get a setup check for the specified sandbox profile version.",
      content: {
        "application/json": {
          schema: getSandboxProfileVersionSetupCheckResponseSchema,
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
      description: "Sandbox profile, profile version, or setup check was not found.",
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
