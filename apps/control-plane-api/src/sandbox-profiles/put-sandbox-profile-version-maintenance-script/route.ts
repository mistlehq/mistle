import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { notFoundResponseSchema } from "../get-sandbox-profile-version-integration-bindings/schema.js";
import {
  putSandboxProfileVersionMaintenanceScriptBodySchema,
  putSandboxProfileVersionMaintenanceScriptResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "put",
  path: "/{profileId}/versions/{version}/maintenance-script",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: putSandboxProfileVersionMaintenanceScriptBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Update the maintenance script for the specified sandbox profile version.",
      content: {
        "application/json": {
          schema: putSandboxProfileVersionMaintenanceScriptResponseSchema,
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
