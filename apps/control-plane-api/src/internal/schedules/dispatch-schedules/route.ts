import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { InternalDispatchSchedulesResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/dispatch",
  tags: ["Internal"],
  responses: {
    202: {
      description: "Enqueue scheduled workflow dispatch for internal callers.",
      content: {
        "application/json": {
          schema: InternalDispatchSchedulesResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
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
