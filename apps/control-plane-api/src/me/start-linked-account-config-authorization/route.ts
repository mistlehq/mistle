import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { StartLinkedAccountAuthorizationResponseSchema } from "../schemas.js";
import {
  StartLinkedAccountConfigAuthorizationBadRequestResponseSchema,
  StartLinkedAccountConfigAuthorizationNotFoundResponseSchema,
  StartLinkedAccountConfigAuthorizationParamsSchema,
  StartLinkedAccountConfigAuthorizationValidationErrorResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/linked-accounts/provider-configs/:organizationProviderConfigId/authorizations",
  tags: ["Me"],
  request: {
    params: StartLinkedAccountConfigAuthorizationParamsSchema,
  },
  responses: {
    200: {
      description:
        "Start linked-account authorization for the authenticated user and provider config.",
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
          schema: StartLinkedAccountConfigAuthorizationBadRequestResponseSchema,
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
          schema: StartLinkedAccountConfigAuthorizationNotFoundResponseSchema,
        },
      },
    },
    422: {
      description: "Validation error.",
      content: {
        "application/json": {
          schema: StartLinkedAccountConfigAuthorizationValidationErrorResponseSchema,
        },
      },
    },
  },
});
