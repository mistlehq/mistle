import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { listDesignerSessionsQuerySchema, listDesignerSessionsResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/sessions",
  tags: ["Designer"],
  request: {
    query: listDesignerSessionsQuerySchema,
  },
  responses: {
    200: {
      description: "List Designer sessions.",
      content: {
        "application/json": {
          schema: listDesignerSessionsResponseSchema,
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
      description: "Active organization is required.",
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
