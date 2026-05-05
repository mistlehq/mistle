import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  RefreshSandboxEgressGrantsBodySchema,
  RefreshSandboxEgressGrantsParamsSchema,
  RefreshSandboxEgressGrantsResponseSchema,
} from "../../../sandbox-instances/refresh-egress-grants/schema.js";

export const route = createRoute({
  method: "post",
  path: "/instances/:id/refresh-egress-grants",
  tags: ["Internal"],
  request: {
    params: RefreshSandboxEgressGrantsParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: RefreshSandboxEgressGrantsBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Refresh sandbox runtime egress grants for internal callers.",
      content: {
        "application/json": {
          schema: RefreshSandboxEgressGrantsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
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
