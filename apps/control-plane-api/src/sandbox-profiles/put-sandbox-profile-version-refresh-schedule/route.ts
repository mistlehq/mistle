import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  putSandboxProfileVersionRefreshScheduleBodySchema,
  sandboxProfileVersionParamsSchema,
  sandboxProfileVersionRefreshScheduleResponseSchema,
} from "../schemas.js";
import { badRequestResponseSchema, notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/{profileId}/versions/{version}/refresh-schedule",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: putSandboxProfileVersionRefreshScheduleBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        "Create or replace the refresh schedule and optionally save the maintenance script for a sandbox profile version.",
      content: {
        "application/json": {
          schema: sandboxProfileVersionRefreshScheduleResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid refresh schedule request.",
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
