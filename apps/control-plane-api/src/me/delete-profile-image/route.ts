import { createRoute, z } from "@hono/zod-openapi";
import { NotFoundResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

export const route = createRoute({
  method: "delete",
  path: "/profile-image",
  tags: ["Me"],
  responses: {
    204: {
      description: "Delete the authenticated user's uploaded profile image.",
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    404: {
      description: "Authenticated user was not found.",
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
