import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { ListSandboxProvidersResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Sandbox Providers"],
  responses: {
    200: {
      description: "List supported sandbox providers and resource capabilities.",
      content: {
        "application/json": {
          schema: ListSandboxProvidersResponseSchema,
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
