import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  putSandboxProfileVersionDraftBodySchema,
  putSandboxProfileVersionDraftResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";
import {
  badRequestResponseSchema,
  conflictResponseSchema,
  notFoundResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/{profileId}/versions/{version}/draft",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: putSandboxProfileVersionDraftBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Update draft fields for the specified sandbox profile version atomically.",
      content: {
        "application/json": {
          schema: putSandboxProfileVersionDraftResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: z.union([ValidationErrorResponseSchema, badRequestResponseSchema]),
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
