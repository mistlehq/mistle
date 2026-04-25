import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartGitHubAppManifestConnectionBadRequestResponseSchema,
  StartGitHubAppManifestConnectionBodySchema,
  StartGitHubAppManifestConnectionNotFoundResponseSchema,
  StartGitHubAppManifestConnectionParamsSchema,
  StartGitHubAppManifestConnectionResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/github-app-manifest/start",
  tags: ["Integrations"],
  request: {
    params: StartGitHubAppManifestConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartGitHubAppManifestConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Create a GitHub App manifest registration form submission.",
      content: {
        "application/json": {
          schema: StartGitHubAppManifestConnectionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartGitHubAppManifestConnectionBadRequestResponseSchema,
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
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: StartGitHubAppManifestConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
