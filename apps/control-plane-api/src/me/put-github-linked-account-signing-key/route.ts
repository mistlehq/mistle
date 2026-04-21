import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { linkedAccountSigningKeyUploadFormSchema } from "../schemas.js";
import {
  PutGitHubLinkedAccountSigningKeyBadRequestResponseSchema,
  PutGitHubLinkedAccountSigningKeyNotFoundResponseSchema,
  ValidationErrorResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/linked-accounts/github/signing-key",
  tags: ["Me"],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: linkedAccountSigningKeyUploadFormSchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: "Upload or replace the authenticated user's GitHub SSH signing key.",
    },
    400: {
      description: "Invalid signing key input.",
      content: {
        "application/json": {
          schema: PutGitHubLinkedAccountSigningKeyBadRequestResponseSchema,
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
          schema: PutGitHubLinkedAccountSigningKeyNotFoundResponseSchema,
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
