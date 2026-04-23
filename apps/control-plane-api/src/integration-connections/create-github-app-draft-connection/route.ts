import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { IntegrationConnectionSchema } from "../schemas.js";
import {
  CreateGitHubAppDraftConnectionBadRequestResponseSchema,
  CreateGitHubAppDraftConnectionBodySchema,
  CreateGitHubAppDraftConnectionNotFoundResponseSchema,
  CreateGitHubAppDraftConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/github-app-installation/draft",
  tags: ["Integrations"],
  request: {
    params: CreateGitHubAppDraftConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateGitHubAppDraftConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a draft GitHub App installation connection.",
      content: {
        "application/json": {
          schema: IntegrationConnectionSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CreateGitHubAppDraftConnectionBadRequestResponseSchema,
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
          schema: CreateGitHubAppDraftConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
