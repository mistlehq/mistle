import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  CreateApiKeyBadRequestResponseSchema,
  CreateApiKeyRequestSchema,
  CreateApiKeyResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/",
  tags: ["API Keys"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateApiKeyRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Create an API key and return the plaintext token once.",
      content: {
        "application/json": {
          schema: CreateApiKeyResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CreateApiKeyBadRequestResponseSchema,
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
      description: "API key management permission is required.",
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
