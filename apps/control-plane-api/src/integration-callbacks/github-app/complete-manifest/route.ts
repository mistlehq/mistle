import { createRoute } from "@hono/zod-openapi";

import { RedirectLocationHeaderSchema } from "../../../integration-connections/schemas.js";
import {
  CompleteGitHubAppManifestConnectionBadRequestResponseSchema,
  CompleteGitHubAppManifestConnectionNotFoundResponseSchema,
  CompleteGitHubAppManifestConnectionQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/github-app-manifest",
  tags: ["Integrations"],
  request: {
    query: CompleteGitHubAppManifestConnectionQuerySchema,
  },
  responses: {
    302: {
      description:
        "Complete GitHub App manifest creation on an existing connection and redirect to dashboard setup.",
      headers: RedirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CompleteGitHubAppManifestConnectionBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: CompleteGitHubAppManifestConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
