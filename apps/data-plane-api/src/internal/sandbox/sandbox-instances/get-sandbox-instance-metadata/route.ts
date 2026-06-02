import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  GetSandboxInstanceMetadataParamsSchema,
  GetSandboxInstanceMetadataQuerySchema,
  GetSandboxInstanceMetadataResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/instances/:id/metadata",
  tags: ["Internal"],
  request: {
    params: GetSandboxInstanceMetadataParamsSchema,
    query: GetSandboxInstanceMetadataQuerySchema,
  },
  responses: {
    200: {
      description: "Get sandbox instance metadata for internal callers.",
      content: {
        "application/json": {
          schema: GetSandboxInstanceMetadataResponseSchema,
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
