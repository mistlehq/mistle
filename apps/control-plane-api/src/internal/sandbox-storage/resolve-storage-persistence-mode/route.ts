import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  InternalSandboxStorageBadRequestResponseSchema,
  ResolveSandboxStoragePersistenceModeRequestSchema,
  ResolveSandboxStoragePersistenceModeResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "post",
  path: "/resolve-persistence-mode",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResolveSandboxStoragePersistenceModeRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve sandbox storage persistence mode for an organization.",
      content: {
        "application/json": {
          schema: ResolveSandboxStoragePersistenceModeResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid resolve persistence mode request.",
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
