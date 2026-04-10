import { createRoute } from "@hono/zod-openapi";

import { RedirectLocationHeaderSchema } from "../schemas.js";
import {
  CompleteGitHubAppInstallationConnectionBadRequestResponseSchema,
  CompleteGitHubAppInstallationConnectionNotFoundResponseSchema,
  CompleteGitHubAppInstallationConnectionQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/github-app-installation",
  tags: ["Integrations"],
  request: {
    query: CompleteGitHubAppInstallationConnectionQuerySchema,
  },
  responses: {
    302: {
      description:
        "Complete GitHub App installation on an existing connection and redirect to dashboard integrations.",
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
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: CompleteGitHubAppInstallationConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
