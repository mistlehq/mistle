import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { IntegrationConnectionSchema } from "../schemas.js";
import {
  CreateApiKeyConnectionBadRequestResponseSchema,
  CreateApiKeyConnectionBodySchema,
  CreateApiKeyConnectionNotFoundResponseSchema,
  CreateApiKeyConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/api-key",
  tags: ["Integrations"],
  request: {
    params: CreateApiKeyConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateApiKeyConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create an API-key backed integration connection.",
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
          schema: CreateApiKeyConnectionBadRequestResponseSchema,
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
          schema: CreateApiKeyConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
