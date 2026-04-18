import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { LinkedAccountsResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/linked-accounts",
  tags: ["Me"],
  responses: {
    200: {
      description:
        "List linked-account status for identity-linking providers configured in the active organization.",
      content: {
        "application/json": {
          schema: LinkedAccountsResponseSchema,
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
