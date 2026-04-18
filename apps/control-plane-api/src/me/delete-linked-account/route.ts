import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  DeleteLinkedAccountParamsSchema,
  DeleteLinkedAccountValidationErrorResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/linked-accounts/:providerFamily",
  tags: ["Me"],
  request: {
    params: DeleteLinkedAccountParamsSchema,
  },
  responses: {
    204: {
      description: "Unlink the authenticated user's linked account for the given provider.",
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    422: {
      description: "Validation error.",
      content: {
        "application/json": {
          schema: DeleteLinkedAccountValidationErrorResponseSchema,
        },
      },
    },
  },
});
