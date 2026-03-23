import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  putSandboxProfileVersionIntegrationBindingsBodySchema,
  putSandboxProfileVersionIntegrationBindingsResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";
import { badRequestResponseSchema, notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/{profileId}/versions/{version}/integration-bindings",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: putSandboxProfileVersionIntegrationBindingsBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Replace integration bindings for the specified sandbox profile version.",
      content: {
        "application/json": {
          schema: putSandboxProfileVersionIntegrationBindingsResponseSchema,
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
