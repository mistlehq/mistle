import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  deleteSandboxProfileVersionRefreshScheduleResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";
import { notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/{profileId}/versions/{version}/refresh-schedule",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
  },
  responses: {
    200: {
      description: "Delete the refresh schedule for a sandbox profile version.",
      content: {
        "application/json": {
          schema: deleteSandboxProfileVersionRefreshScheduleResponseSchema,
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
