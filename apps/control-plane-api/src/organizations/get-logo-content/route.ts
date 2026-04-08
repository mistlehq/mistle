import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
} from "@mistle/http/errors.js";

import { RedirectLocationHeaderSchema } from "../../integration-connections/schemas.js";
import { OrganizationLogoParamsSchema } from "../organization-logo-schema.js";

export const route = createRoute({
  method: "get",
  path: "/{organizationId}/logo/content",
  tags: ["Organizations"],
  request: {
    params: OrganizationLogoParamsSchema,
    query: z
      .object({
        v: z.string().min(1).optional(),
      })
      .strict(),
  },
  responses: {
    302: {
      description: "Redirect to the active organization's current logo content.",
      headers: RedirectLocationHeaderSchema,
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
      description: "Organization logo was not found.",
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
