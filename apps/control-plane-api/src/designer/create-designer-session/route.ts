import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  createDesignerSessionBodySchema,
  createDesignerSessionResponseSchema,
} from "../schemas.js";
import { badRequestResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/sessions",
  tags: ["Designer"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createDesignerSessionBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Create a Designer session.",
      content: {
        "application/json": {
          schema: createDesignerSessionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: badRequestResponseSchema,
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
