import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  DeleteIntegrationConnectionBadRequestResponseSchema,
  DeleteIntegrationConnectionConflictResponseSchema,
  DeleteIntegrationConnectionNotFoundResponseSchema,
  DeleteIntegrationConnectionParamsSchema,
  DeleteIntegrationConnectionResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/:connectionId",
  tags: ["Integrations"],
  request: {
    params: DeleteIntegrationConnectionParamsSchema,
  },
  responses: {
    200: {
      description: "Delete an integration connection.",
      content: {
        "application/json": {
          schema: DeleteIntegrationConnectionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: DeleteIntegrationConnectionBadRequestResponseSchema,
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
          schema: DeleteIntegrationConnectionNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Integration connection still has one or more bindings.",
      content: {
        "application/json": {
          schema: DeleteIntegrationConnectionConflictResponseSchema,
        },
      },
    },
  },
});
