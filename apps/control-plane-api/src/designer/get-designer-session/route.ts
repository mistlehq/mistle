import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { designerSessionIdParamsSchema, getDesignerSessionResponseSchema } from "../schemas.js";
import { notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/sessions/{sessionId}",
  tags: ["Designer"],
  request: {
    params: designerSessionIdParamsSchema,
  },
  responses: {
    200: {
      description: "Get a Designer session.",
      content: {
        "application/json": {
          schema: getDesignerSessionResponseSchema,
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
    404: {
      description: "Designer session was not found.",
      content: {
        "application/json": {
          schema: notFoundResponseSchema,
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
