import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  InternalSandboxRuntimeBadRequestResponseSchema,
  InternalSandboxRuntimeErrorResponseSchema,
} from "../schemas.js";
import {
  InternalSandboxRuntimeGetSandboxInstanceRequestSchema,
  InternalSandboxRuntimeGetSandboxInstanceResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/get-sandbox-instance",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeGetSandboxInstanceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Get sandbox instance status for internal callers.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeGetSandboxInstanceResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    404: {
      description: "Referenced sandbox instance was not found.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
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
