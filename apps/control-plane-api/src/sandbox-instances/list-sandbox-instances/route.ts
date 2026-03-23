import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { listSandboxInstancesQuerySchema, listSandboxInstancesResponseSchema } from "../schemas.js";
import { badRequestResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Sandbox Instances"],
  request: {
    query: listSandboxInstancesQuerySchema,
  },
  responses: {
    200: {
      description: "List sandbox instances.",
      content: {
        "application/json": {
          schema: listSandboxInstancesResponseSchema,
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
