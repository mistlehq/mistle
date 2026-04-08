import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { MemberAvatarsResponseSchema } from "../schemas.js";
import { ListMemberAvatarsParamsSchema, ListMemberAvatarsRequestBodySchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/{organizationId}/member-avatars",
  tags: ["Organizations"],
  request: {
    params: ListMemberAvatarsParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: ListMemberAvatarsRequestBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Batch avatar state for organization members.",
      content: {
        "application/json": {
          schema: MemberAvatarsResponseSchema,
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
