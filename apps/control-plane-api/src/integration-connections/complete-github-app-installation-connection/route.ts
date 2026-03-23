import { createRoute } from "@hono/zod-openapi";

import {
  IntegrationConnectionsNotFoundResponseSchema,
  RedirectLocationHeaderSchema,
} from "../schemas.js";
import {
  CompleteGitHubAppInstallationConnectionBadRequestResponseSchema,
  CompleteGitHubAppInstallationConnectionParamsSchema,
  CompleteGitHubAppInstallationConnectionQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/:targetKey/github-app-installation/complete",
  tags: ["Integrations"],
  request: {
    params: CompleteGitHubAppInstallationConnectionParamsSchema,
    query: CompleteGitHubAppInstallationConnectionQuerySchema,
  },
  responses: {
    302: {
      description:
        "Complete GitHub App installation connection creation and redirect to dashboard integrations.",
      headers: RedirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CompleteGitHubAppInstallationConnectionBadRequestResponseSchema,
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
