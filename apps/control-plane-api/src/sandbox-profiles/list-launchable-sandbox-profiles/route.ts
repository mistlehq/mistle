import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { listLaunchableSandboxProfilesResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/launchable",
  tags: ["Sandbox Profiles"],
  responses: {
    200: {
      description: "List launchable sandbox profiles.",
      content: {
        "application/json": {
          schema: listLaunchableSandboxProfilesResponseSchema,
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
