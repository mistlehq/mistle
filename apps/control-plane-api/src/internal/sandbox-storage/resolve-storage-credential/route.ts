import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  InternalSandboxStorageBadRequestResponseSchema,
  ResolveSandboxStorageCredentialRequestSchema,
  ResolveSandboxStorageCredentialResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "post",
  path: "/resolve-credential",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResolveSandboxStorageCredentialRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve sandbox storage credential for trusted internal callers.",
      content: {
        "application/json": {
          schema: ResolveSandboxStorageCredentialResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid resolve credential request.",
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
