import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { CurrentActorResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Me"],
  responses: {
    200: {
      description: "Read the authenticated request actor and organization context.",
      content: {
        "application/json": {
          schema: CurrentActorResponseSchema,
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
      description: "Active organization is required for this request.",
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
