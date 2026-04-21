import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  listSessionSidebarGroupsQuerySchema,
  listSessionSidebarGroupsResponseSchema,
} from "../schemas.js";
import { badRequestResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/recent",
  tags: ["Sandbox Instances"],
  request: {
    query: listSessionSidebarGroupsQuerySchema,
  },
  responses: {
    200: {
      description: "List session sidebar groups.",
      content: {
        "application/json": {
          schema: listSessionSidebarGroupsResponseSchema,
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
