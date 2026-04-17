import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProvidersResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/identity-linking/providers",
  tags: ["Organizations"],
  responses: {
    200: {
      description: "Identity-linking providers and current organization configuration state.",
      content: {
        "application/json": {
          schema: OrganizationIdentityLinkProvidersResponseSchema,
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
