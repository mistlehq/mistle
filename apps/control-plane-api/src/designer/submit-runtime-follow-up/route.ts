import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  designerSessionIdParamsSchema,
  submitDesignerRuntimeFollowUpBodySchema,
  submitDesignerRuntimeFollowUpResponseSchema,
} from "../schemas.js";
import { conflictResponseSchema, notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/sessions/{sessionId}/runtime-conversation/follow-ups",
  tags: ["Designer"],
  request: {
    params: designerSessionIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: submitDesignerRuntimeFollowUpBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Submit a follow-up prompt to the Designer runtime conversation.",
      content: {
        "application/json": {
          schema: submitDesignerRuntimeFollowUpResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
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
      description:
        "Designer runtime conversation is not ready or is still processing another turn.",
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
