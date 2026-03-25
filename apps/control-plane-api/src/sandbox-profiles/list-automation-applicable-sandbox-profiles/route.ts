import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { listAutomationApplicableSandboxProfilesResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/automation-applicable",
  tags: ["Sandbox Profiles"],
  responses: {
    200: {
      description: "List sandbox profiles applicable to webhook-triggered automations.",
      content: {
        "application/json": {
          schema: listAutomationApplicableSandboxProfilesResponseSchema,
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
