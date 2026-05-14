import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartOAuth2AuthorizationCodeConnectionReauthorizationBadRequestResponseSchema,
  StartOAuth2AuthorizationCodeConnectionReauthorizationConflictResponseSchema,
  StartOAuth2AuthorizationCodeConnectionReauthorizationNotFoundResponseSchema,
  StartOAuth2AuthorizationCodeConnectionReauthorizationParamsSchema,
  StartOAuth2AuthorizationCodeConnectionReauthorizationResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/oauth2-authorization-code/reauthorize/start",
  tags: ["Integrations"],
  request: {
    params: StartOAuth2AuthorizationCodeConnectionReauthorizationParamsSchema,
  },
  responses: {
    200: {
      description:
        "Create an OAuth 2.0 (Authorization Code) reauthorization URL for an integration connection.",
      content: {
        "application/json": {
          schema: StartOAuth2AuthorizationCodeConnectionReauthorizationResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartOAuth2AuthorizationCodeConnectionReauthorizationBadRequestResponseSchema,
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
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Integration connection or target was not found.",
      content: {
        "application/json": {
          schema: StartOAuth2AuthorizationCodeConnectionReauthorizationNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Integration connection cannot be reauthorized.",
      content: {
        "application/json": {
          schema: StartOAuth2AuthorizationCodeConnectionReauthorizationConflictResponseSchema,
        },
      },
    },
  },
});
