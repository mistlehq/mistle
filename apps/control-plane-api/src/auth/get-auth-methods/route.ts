import { createRoute, z } from "@hono/zod-openapi";

import { authMethodsResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/methods",
  tags: ["Auth"],
  responses: {
    200: {
      description: "Get the auth methods available for dashboard login.",
      content: {
        "application/json": {
          schema: authMethodsResponseSchema,
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
