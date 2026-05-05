import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  putSandboxProfileVersionPersistenceModeBodySchema,
  putSandboxProfileVersionPersistenceModeResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";
import { conflictResponseSchema, notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/{profileId}/versions/{version}/persistence-mode",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: putSandboxProfileVersionPersistenceModeBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        "Replace the default persistence mode for the specified sandbox profile version.",
      content: {
        "application/json": {
          schema: putSandboxProfileVersionPersistenceModeResponseSchema,
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
    409: {
      description: "Sandbox profile version is not editable.",
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
