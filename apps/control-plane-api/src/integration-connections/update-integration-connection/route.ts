import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { IntegrationConnectionSchema } from "../schemas.js";
import {
  UpdateIntegrationConnectionBadRequestResponseSchema,
  UpdateIntegrationConnectionBodySchema,
  UpdateIntegrationConnectionNotFoundResponseSchema,
  UpdateIntegrationConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/:connectionId",
  tags: ["Integrations"],
  request: {
    params: UpdateIntegrationConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateIntegrationConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update an existing integration connection.",
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
          schema: UpdateIntegrationConnectionBadRequestResponseSchema,
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
          schema: UpdateIntegrationConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
