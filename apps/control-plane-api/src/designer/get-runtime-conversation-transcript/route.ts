import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  designerSessionIdParamsSchema,
  getDesignerRuntimeConversationTranscriptResponseSchema,
} from "../schemas.js";
import {
  conflictResponseSchema,
  notFoundResponseSchema,
} from "../submit-runtime-follow-up/schema.js";

export const route = createRoute({
  method: "get",
  path: "/sessions/{sessionId}/runtime-conversation/transcript",
  tags: ["Designer"],
  request: {
    params: designerSessionIdParamsSchema,
  },
  responses: {
    200: {
      description: "Read the current Designer runtime conversation transcript from the provider.",
      content: {
        "application/json": {
          schema: getDesignerRuntimeConversationTranscriptResponseSchema,
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
      description: "Designer runtime conversation is not ready for transcript reads.",
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
