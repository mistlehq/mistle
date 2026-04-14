import { createRoute, z } from "@hono/zod-openapi";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  redirectLocationHeaderSchema,
  sandboxInstanceIdParamsSchema,
} from "../../sandbox-instances/schemas.js";

export const route = createRoute({
  method: "get",
  path: "/{instanceId}",
  tags: ["Public Session Links"],
  request: {
    params: sandboxInstanceIdParamsSchema,
  },
  responses: {
    302: {
      description: "Redirect to the dashboard session view for a sandbox instance.",
      headers: redirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
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
