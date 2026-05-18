import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
} from "@mistle/http/errors.js";

import { OrganizationBillingResponseSchema } from "../get-billing/schema.js";

export const route = createRoute({
  method: "post",
  path: "/billing/customer",
  tags: ["Organizations"],
  responses: {
    200: {
      description: "Ensure billing customer provisioning for the active organization.",
      content: {
        "application/json": {
          schema: OrganizationBillingResponseSchema,
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
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Billing is not available.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
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
