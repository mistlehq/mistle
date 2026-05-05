import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  sandboxProfileVersionParamsSchema,
  startSandboxProfileSetupAssistantBodySchema,
  startSandboxProfileSetupAssistantResponseSchema,
} from "../schemas.js";
import {
  badRequestResponseSchema,
  notFoundResponseSchema,
} from "../start-sandbox-profile-instance/schema.js";

export const route = createRoute({
  method: "post",
  path: "/{profileId}/versions/{version}/setup-script/assistant",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: startSandboxProfileSetupAssistantBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Start a Setup Assistant sandbox for the specified profile version.",
      content: {
        "application/json": {
          schema: startSandboxProfileSetupAssistantResponseSchema,
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
