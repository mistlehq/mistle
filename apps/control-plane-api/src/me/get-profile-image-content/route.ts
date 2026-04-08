import { createRoute, z } from "@hono/zod-openapi";
import { NotFoundResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { RedirectLocationHeaderSchema } from "../../integration-connections/schemas.js";

export const route = createRoute({
  method: "get",
  path: "/profile-image/content",
  tags: ["Me"],
  request: {
    query: z
      .object({
        v: z.string().min(1).optional(),
      })
      .strict(),
  },
  responses: {
    302: {
      description: "Redirect to the authenticated user's current profile image content.",
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
    404: {
      description: "Authenticated user profile image was not found.",
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
