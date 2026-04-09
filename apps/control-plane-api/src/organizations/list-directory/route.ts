import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { DirectoryResponseSchema } from "../schemas.js";
import { ListDirectoryParamsSchema, ListDirectoryQuerySchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/{organizationId}/directory",
  tags: ["Organizations"],
  request: {
    params: ListDirectoryParamsSchema,
    query: ListDirectoryQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated organization directory entries.",
      content: {
        "application/json": {
          schema: DirectoryResponseSchema,
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
    404: {
      description: "Organization was not found.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
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
