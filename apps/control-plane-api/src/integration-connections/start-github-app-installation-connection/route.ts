import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { ProtectedIntegrationConnectionsRouteMiddleware } from "../middleware.js";
import { IntegrationConnectionsNotFoundResponseSchema } from "../schemas.js";
import {
  StartGitHubAppInstallationConnectionBadRequestResponseSchema,
  StartGitHubAppInstallationConnectionBodySchema,
  StartGitHubAppInstallationConnectionParamsSchema,
  StartGitHubAppInstallationConnectionResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/github-app-installation/start",
  tags: ["Integrations"],
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
  request: {
    params: StartGitHubAppInstallationConnectionParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: StartGitHubAppInstallationConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Create a GitHub App installation authorization URL for an integration target.",
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
      description: "Integration target was not found.",
      content: {
        "application/json": {
          schema: IntegrationConnectionsNotFoundResponseSchema,
        },
      },
    },
  },
});
