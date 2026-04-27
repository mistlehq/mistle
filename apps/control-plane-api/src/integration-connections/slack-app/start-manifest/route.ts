import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartSlackAppManifestConnectionBadRequestResponseSchema,
  StartSlackAppManifestConnectionBodySchema,
  StartSlackAppManifestConnectionNotFoundResponseSchema,
  StartSlackAppManifestConnectionParamsSchema,
  StartSlackAppManifestConnectionResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/slack-app-manifest/start",
  tags: ["Integrations"],
  request: {
    params: StartSlackAppManifestConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartSlackAppManifestConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Create a Slack app from a manifest and return the installation URL.",
      content: {
        "application/json": {
          schema: StartSlackAppManifestConnectionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartSlackAppManifestConnectionBadRequestResponseSchema,
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
          schema: StartSlackAppManifestConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
