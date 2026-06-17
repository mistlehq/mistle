import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  designerSessionIdParamsSchema,
  putDesignerSessionCanvasTabsBodySchema,
  putDesignerSessionCanvasTabsResponseSchema,
} from "../schemas.js";
import { notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/sessions/{sessionId}/canvas-tabs",
  tags: ["Designer"],
  request: {
    params: designerSessionIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: putDesignerSessionCanvasTabsBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Update Designer session canvas tabs.",
      content: {
        "application/json": {
          schema: putDesignerSessionCanvasTabsResponseSchema,
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
