import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { sandboxInstanceConnectionTokenSchema } from "../../sandbox-instances/schemas.js";
import { notFoundResponseSchema } from "../get-designer-session/schema.js";
import { designerSessionIdParamsSchema } from "../schemas.js";

const bodySchema = z.object({}).strict();

export const route = createRoute({
  method: "post",
  path: "/sessions/{sessionId}/connection-tokens",
  tags: ["Designer"],
  request: {
    params: designerSessionIdParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: bodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Issue a short-lived connection token for a Designer runtime sandbox.",
      content: {
        "application/json": {
          schema: sandboxInstanceConnectionTokenSchema,
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
      description: "Designer runtime sandbox is not running.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
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
