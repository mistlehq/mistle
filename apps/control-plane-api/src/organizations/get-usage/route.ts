import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { OrganizationUsageQuerySchema, OrganizationUsageResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/usage",
  tags: ["Organizations"],
  request: {
    query: OrganizationUsageQuerySchema,
  },
  responses: {
    200: {
      description: "Sandbox usage for the active organization.",
      content: {
        "application/json": {
          schema: OrganizationUsageResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request query.",
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
      description: "Forbidden request.",
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
