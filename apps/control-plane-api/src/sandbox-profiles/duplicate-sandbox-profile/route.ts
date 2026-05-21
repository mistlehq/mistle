import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  duplicateSandboxProfileBodySchema,
  duplicateSandboxProfileResponseSchema,
  sandboxProfileIdParamsSchema,
} from "../schemas.js";
import {
  badRequestResponseSchema,
  conflictResponseSchema,
  notFoundResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/{profileId}/duplicate",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: duplicateSandboxProfileBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Duplicate a sandbox profile from its active usable snapshot.",
      content: {
        "application/json": {
          schema: duplicateSandboxProfileResponseSchema,
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
      description: "Sandbox profile was not found.",
      content: {
        "application/json": {
          schema: notFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Sandbox profile cannot be duplicated.",
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
