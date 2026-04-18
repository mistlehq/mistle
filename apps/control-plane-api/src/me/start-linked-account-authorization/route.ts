import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { StartLinkedAccountAuthorizationResponseSchema } from "../schemas.js";
import {
  StartLinkedAccountAuthorizationBadRequestResponseSchema,
  StartLinkedAccountAuthorizationNotFoundResponseSchema,
  StartLinkedAccountAuthorizationParamsSchema,
  StartLinkedAccountAuthorizationValidationErrorResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/linked-accounts/:providerFamily",
  tags: ["Me"],
  request: {
    params: StartLinkedAccountAuthorizationParamsSchema,
  },
  responses: {
    200: {
      description: "Start linked-account authorization for the authenticated user.",
      content: {
        "application/json": {
          schema: StartLinkedAccountAuthorizationResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartLinkedAccountAuthorizationBadRequestResponseSchema,
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
    404: {
      description: "Provider configuration was not found.",
      content: {
        "application/json": {
          schema: StartLinkedAccountAuthorizationNotFoundResponseSchema,
        },
      },
    },
    422: {
      description: "Validation error.",
      content: {
        "application/json": {
          schema: StartLinkedAccountAuthorizationValidationErrorResponseSchema,
        },
      },
    },
  },
});
