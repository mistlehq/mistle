import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartGitHubAppInstallationConnectionBadRequestResponseSchema,
  StartGitHubAppInstallationConnectionNotFoundResponseSchema,
  StartGitHubAppInstallationConnectionParamsSchema,
  StartGitHubAppInstallationConnectionResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/github-app-installation/start",
  tags: ["Integrations"],
  request: {
    params: StartGitHubAppInstallationConnectionParamsSchema,
  },
  responses: {
    200: {
      description:
        "Create a GitHub App installation authorization URL for an existing integration connection.",
      content: {
        "application/json": {
          schema: StartGitHubAppInstallationConnectionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartGitHubAppInstallationConnectionBadRequestResponseSchema,
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
          schema: StartGitHubAppInstallationConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
