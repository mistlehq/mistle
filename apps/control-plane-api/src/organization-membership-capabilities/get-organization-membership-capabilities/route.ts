import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { errorResponseSchema, paramsSchema, successResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/{organizationId}/membership-capabilities",
  tags: ["Organizations"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: {
      description: "Membership capabilities for the current actor in the organization.",
      content: {
        "application/json": {
          schema: successResponseSchema,
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
      description: "Forbidden request.",
      content: {
        "application/json": {
          schema: z.union([ForbiddenResponseSchema, errorResponseSchema]),
        },
      },
    },
    404: {
      description: "Organization was not found.",
      content: {
        "application/json": {
          schema: errorResponseSchema,
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
