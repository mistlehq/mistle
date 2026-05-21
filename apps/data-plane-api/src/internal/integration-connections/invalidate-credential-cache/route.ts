import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  InvalidateCredentialCacheParamsSchema,
  InvalidateCredentialCacheResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/credential-cache/invalidate",
  tags: ["Internal"],
  request: {
    params: InvalidateCredentialCacheParamsSchema,
  },
  responses: {
    200: {
      description: "Invalidate cached gateway egress credentials for an integration connection.",
      content: {
        "application/json": {
          schema: InvalidateCredentialCacheResponseSchema,
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
