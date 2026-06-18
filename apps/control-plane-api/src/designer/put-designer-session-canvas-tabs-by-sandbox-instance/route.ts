import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { notFoundResponseSchema } from "../get-designer-session/schema.js";
import {
  designerSandboxInstanceIdParamsSchema,
  putDesignerSessionCanvasTabsBodySchema,
  putDesignerSessionCanvasTabsResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "put",
  path: "/sandbox-instances/{instanceId}/canvas-tabs",
  tags: ["Designer"],
  request: {
    params: designerSandboxInstanceIdParamsSchema,
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
      description: "Update Designer canvas tabs for a sandbox instance.",
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
