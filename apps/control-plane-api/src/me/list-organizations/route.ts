import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { CurrentUserOrganizationsResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/organizations",
  tags: ["Me"],
  responses: {
    200: {
      description: "List organizations available to the authenticated user.",
      content: {
        "application/json": {
          schema: CurrentUserOrganizationsResponseSchema,
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
      description: "User-backed authentication is required.",
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
