import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  InternalSandboxStorageBadRequestResponseSchema,
  ResolveSandboxStorageConfigurationRequestSchema,
  ResolveSandboxStorageConfigurationResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "post",
  path: "/resolve-configuration",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResolveSandboxStorageConfigurationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve effective sandbox storage configuration for an organization.",
      content: {
        "application/json": {
          schema: ResolveSandboxStorageConfigurationResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid resolve configuration request.",
      content: {
        "application/json": {
          schema: InternalSandboxStorageBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
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
