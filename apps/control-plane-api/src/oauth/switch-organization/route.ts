import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { OAuthTokenResponseSchema } from "../schemas.js";
import { OAuthSwitchOrganizationRequestSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/switch-organization",
  tags: ["OAuth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: OAuthSwitchOrganizationRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Mint a fresh OAuth token pair scoped to another organization.",
      content: {
        "application/json": {
          schema: OAuthTokenResponseSchema,
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
      description: "OAuth bearer authentication is required.",
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
      description: "Target organization was not found.",
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
