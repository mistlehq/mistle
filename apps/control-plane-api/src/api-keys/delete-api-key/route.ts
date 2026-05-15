import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { ApiKeyIdParamsSchema } from "../schemas.js";
import { DeleteApiKeyNotFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/{apiKeyId}",
  tags: ["API Keys"],
  request: {
    params: ApiKeyIdParamsSchema,
  },
  responses: {
    204: {
      description: "Revoke an API key.",
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
    404: {
      description: "API key was not found.",
      content: {
        "application/json": {
          schema: DeleteApiKeyNotFoundResponseSchema,
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
