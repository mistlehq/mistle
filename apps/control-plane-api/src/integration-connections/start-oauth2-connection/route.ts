import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartOAuth2ConnectionBadRequestResponseSchema,
  StartOAuth2ConnectionBodySchema,
  StartOAuth2ConnectionNotFoundResponseSchema,
  StartOAuth2ConnectionParamsSchema,
  StartOAuth2ConnectionResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/oauth2/start",
  tags: ["Integrations"],
  request: {
    params: StartOAuth2ConnectionParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: StartOAuth2ConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Create an OAuth2 authorization URL for an integration target.",
      content: {
        "application/json": {
          schema: StartOAuth2ConnectionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartOAuth2ConnectionBadRequestResponseSchema,
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
          schema: StartOAuth2ConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
