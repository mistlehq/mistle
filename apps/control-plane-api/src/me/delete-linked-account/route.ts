import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  DeleteLinkedAccountBadRequestResponseSchema,
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
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: DeleteLinkedAccountBadRequestResponseSchema,
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
