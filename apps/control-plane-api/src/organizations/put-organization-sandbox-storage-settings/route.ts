import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  PutOrganizationSandboxStorageSettingsRequestSchema,
  PutOrganizationSandboxStorageSettingsResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "put",
  path: "/sandbox-storage-settings",
  tags: ["Organizations"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PutOrganizationSandboxStorageSettingsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated sandbox storage settings for the active organization.",
      content: {
        "application/json": {
          schema: PutOrganizationSandboxStorageSettingsResponseSchema,
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
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden request.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Organization was not found.",
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
