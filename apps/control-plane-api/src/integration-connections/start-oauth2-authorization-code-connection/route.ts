import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema,
  StartOAuth2AuthorizationCodeConnectionBodySchema,
  StartOAuth2AuthorizationCodeConnectionNotFoundResponseSchema,
  StartOAuth2AuthorizationCodeConnectionParamsSchema,
  StartOAuth2AuthorizationCodeConnectionResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/oauth2-authorization-code/start",
  tags: ["Integrations"],
  request: {
    params: StartOAuth2AuthorizationCodeConnectionParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: StartOAuth2AuthorizationCodeConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Create an OAuth 2.0 (Authorization Code) authorization URL for an integration target.",
      content: {
        "application/json": {
          schema: StartOAuth2AuthorizationCodeConnectionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema,
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
      description: "Integration target was not found.",
      content: {
        "application/json": {
          schema: StartOAuth2AuthorizationCodeConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
