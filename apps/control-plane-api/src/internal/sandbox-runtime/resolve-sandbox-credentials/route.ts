import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  InternalSandboxRuntimeBadRequestResponseSchema,
  InternalSandboxRuntimeErrorResponseSchema,
} from "../schemas.js";
import {
  InternalSandboxRuntimeResolveCredentialsRequestSchema,
  InternalSandboxRuntimeResolveCredentialsResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/resolve-credentials",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeResolveCredentialsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve sandbox provider credentials for internal data-plane callers.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeResolveCredentialsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid sandbox credential resolution request.",
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
      description: "Sandbox credential resolution dependency was not found.",
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
