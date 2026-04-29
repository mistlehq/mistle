import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  GetSetupCheckSandboxInstanceParamsSchema,
  GetSetupCheckSandboxInstanceQuerySchema,
  GetSetupCheckSandboxInstanceResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/instances/setup-checks/:id",
  tags: ["Internal"],
  request: {
    params: GetSetupCheckSandboxInstanceParamsSchema,
    query: GetSetupCheckSandboxInstanceQuerySchema,
  },
  responses: {
    200: {
      description: "Get setup-check sandbox instance status for internal callers.",
      content: {
        "application/json": {
          schema: GetSetupCheckSandboxInstanceResponseSchema,
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
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
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
