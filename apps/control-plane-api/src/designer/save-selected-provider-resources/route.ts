import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  designerSessionIdParamsSchema,
  saveDesignerSelectedProviderResourcesBodySchema,
  saveDesignerSelectedProviderResourcesResponseSchema,
} from "../schemas.js";
import { badRequestResponseSchema, notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/sessions/{sessionId}/dashboard-actions/save-selected-provider-resources",
  tags: ["Designer"],
  request: {
    params: designerSessionIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: saveDesignerSelectedProviderResourcesBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Save selected provider resources to a sandbox profile draft.",
      content: {
        "application/json": {
          schema: saveDesignerSelectedProviderResourcesResponseSchema,
        },
      },
    },
    400: {
      description: "Dashboard action input is invalid.",
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
      description: "Required organization permissions are missing.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Designer session was not found.",
      content: {
        "application/json": {
          schema: notFoundResponseSchema,
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
