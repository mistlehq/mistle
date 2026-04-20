import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  PutGitHubLinkedAccountPreferredEmailBadRequestResponseSchema,
  PutGitHubLinkedAccountPreferredEmailBodySchema,
  PutGitHubLinkedAccountPreferredEmailNotFoundResponseSchema,
  ValidationErrorResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/linked-accounts/github/preferred-email",
  tags: ["Me"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PutGitHubLinkedAccountPreferredEmailBodySchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: "Update the authenticated user's preferred GitHub email for Git identity.",
    },
    400: {
      description: "Invalid preferred email selection.",
      content: {
        "application/json": {
          schema: PutGitHubLinkedAccountPreferredEmailBadRequestResponseSchema,
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
      description: "GitHub linked account was not found.",
      content: {
        "application/json": {
          schema: PutGitHubLinkedAccountPreferredEmailNotFoundResponseSchema,
        },
      },
    },
    422: {
      description: "Validation error.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
  },
});
