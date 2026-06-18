import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  designerUserInputRequestIdParamsSchema,
  submitDesignerUserInputRequestResponseBodySchema,
  submitDesignerUserInputRequestResponseResponseSchema,
} from "../schemas.js";
import {
  badRequestResponseSchema,
  conflictResponseSchema,
  notFoundResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/sessions/{sessionId}/runtime-conversation/user-input-requests/{requestId}/responses",
  tags: ["Designer"],
  request: {
    params: designerUserInputRequestIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: submitDesignerUserInputRequestResponseBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Submit a Designer user input request response to the runtime conversation.",
      content: {
        "application/json": {
          schema: submitDesignerUserInputRequestResponseResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: z.union([ValidationErrorResponseSchema, badRequestResponseSchema]),
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
        "Designer runtime conversation is not ready, is busy, or request is not pending.",
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
