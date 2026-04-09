import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { InvitationsPageResponseSchema } from "../schemas.js";
import { ListInvitationsParamsSchema, ListInvitationsQuerySchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/{organizationId}/invitations",
  tags: ["Organizations"],
  request: {
    params: ListInvitationsParamsSchema,
    query: ListInvitationsQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated organization invitations.",
      content: {
        "application/json": {
          schema: InvitationsPageResponseSchema,
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
