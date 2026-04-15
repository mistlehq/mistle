import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  EncryptSandboxStorageCredentialRequestSchema,
  EncryptSandboxStorageCredentialResponseSchema,
  InternalSandboxStorageBadRequestResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "post",
  path: "/encrypt-credential",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: EncryptSandboxStorageCredentialRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Encrypt sandbox storage credential for trusted internal callers.",
      content: {
        "application/json": {
          schema: EncryptSandboxStorageCredentialResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid encrypt credential request.",
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
