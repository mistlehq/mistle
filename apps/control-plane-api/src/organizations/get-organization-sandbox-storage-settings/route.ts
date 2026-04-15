import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
} from "@mistle/http/errors.js";

import { GetOrganizationSandboxStorageSettingsResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/sandbox-storage-settings",
  tags: ["Organizations"],
  responses: {
    200: {
      description: "Current sandbox storage settings for the active organization.",
      content: {
        "application/json": {
          schema: GetOrganizationSandboxStorageSettingsResponseSchema,
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
      description: "Organization was not found.",
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
