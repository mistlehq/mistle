import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  bootstrapDesignerRuntimeConversationResponseSchema,
  designerSessionIdParamsSchema,
} from "../schemas.js";
import {
  badRequestResponseSchema,
  conflictResponseSchema,
  notFoundResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/sessions/{sessionId}/runtime-conversation",
  tags: ["Designer"],
  request: {
    params: designerSessionIdParamsSchema,
  },
  responses: {
    200: {
      description: "Create or resume the Designer runtime conversation.",
      content: {
        "application/json": {
          schema: bootstrapDesignerRuntimeConversationResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
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
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Designer session not found.",
      content: {
        "application/json": {
          schema: notFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Designer sandbox is not ready for runtime conversation bootstrap.",
      content: {
        "application/json": {
          schema: conflictResponseSchema,
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
