import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
} from "@mistle/http/errors.js";

import { OrganizationLogoParamsSchema } from "../organization-logo-schema.js";
import { organizationLogoStateResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/{organizationId}/logo",
  tags: ["Organizations"],
  request: {
    params: OrganizationLogoParamsSchema,
  },
  responses: {
    200: {
      description: "Read the active organization's current logo URL.",
      content: {
        "application/json": {
          schema: organizationLogoStateResponseSchema,
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
