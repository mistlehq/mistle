import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  DeleteSandboxInstanceDeadlineOkResponseSchema,
  DeleteSandboxInstanceDeadlineParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/instances/:id/deadlines/:kind",
  tags: ["Internal"],
  request: {
    params: DeleteSandboxInstanceDeadlineParamsSchema,
  },
  responses: {
    200: {
      description: "Clear a sandbox instance deadline for internal callers.",
      content: {
        "application/json": {
          schema: DeleteSandboxInstanceDeadlineOkResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid deadline request.",
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
