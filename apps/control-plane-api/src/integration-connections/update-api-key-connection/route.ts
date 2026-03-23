import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { IntegrationConnectionSchema } from "../schemas.js";
import {
  UpdateApiKeyConnectionBadRequestResponseSchema,
  UpdateApiKeyConnectionBodySchema,
  UpdateApiKeyConnectionNotFoundResponseSchema,
  UpdateApiKeyConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/:connectionId/api-key",
  tags: ["Integrations"],
  request: {
    params: UpdateApiKeyConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateApiKeyConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Rotate the API key for an existing integration connection.",
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
          schema: UpdateApiKeyConnectionBadRequestResponseSchema,
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
      description: "Integration target or connection was not found.",
      content: {
        "application/json": {
          schema: UpdateApiKeyConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
