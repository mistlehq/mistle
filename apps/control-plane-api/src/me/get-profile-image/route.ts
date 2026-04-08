import { createRoute, z } from "@hono/zod-openapi";
import { NotFoundResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { profileImageMetadataResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/profile-image",
  tags: ["Me"],
  responses: {
    200: {
      description: "Read the authenticated user's current profile image metadata.",
      content: {
        "application/json": {
          schema: profileImageMetadataResponseSchema,
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
