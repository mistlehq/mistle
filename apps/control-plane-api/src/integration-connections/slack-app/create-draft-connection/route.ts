import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { IntegrationConnectionSchema } from "../../schemas.js";
import {
  CreateSlackAppDraftConnectionBadRequestResponseSchema,
  CreateSlackAppDraftConnectionBodySchema,
  CreateSlackAppDraftConnectionNotFoundResponseSchema,
  CreateSlackAppDraftConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/slack-app/draft",
  tags: ["Integrations"],
  request: {
    params: CreateSlackAppDraftConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateSlackAppDraftConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a draft Slack app manifest connection.",
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
          schema: CreateSlackAppDraftConnectionBadRequestResponseSchema,
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
          schema: CreateSlackAppDraftConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
