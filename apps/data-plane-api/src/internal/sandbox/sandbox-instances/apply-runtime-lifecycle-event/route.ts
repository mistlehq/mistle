import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  ApplyRuntimeLifecycleEventBodySchema,
  ApplyRuntimeLifecycleEventOkResponseSchema,
  ApplyRuntimeLifecycleEventParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/instances/:id/runtime-lifecycle-events",
  tags: ["Internal"],
  request: {
    params: ApplyRuntimeLifecycleEventParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ApplyRuntimeLifecycleEventBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Apply a sandbox runtime lifecycle event for internal callers.",
      content: {
        "application/json": {
          schema: ApplyRuntimeLifecycleEventOkResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid lifecycle event request.",
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
