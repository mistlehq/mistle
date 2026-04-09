import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { homeSummaryResponseSchema } from "../schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Home"],
  responses: {
    200: {
      description: "Get onboarding summary for the authenticated organization.",
      content: {
        "application/json": {
          schema: homeSummaryResponseSchema,
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
