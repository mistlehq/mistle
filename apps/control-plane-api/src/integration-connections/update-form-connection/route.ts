import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { IntegrationConnectionSchema } from "../schemas.js";
import {
  UpdateFormConnectionBadRequestResponseSchema,
  UpdateFormConnectionBodySchema,
  UpdateFormConnectionConflictResponseSchema,
  UpdateFormConnectionNotFoundResponseSchema,
  UpdateFormConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/:connectionId/form",
  tags: ["Integrations"],
  request: {
    params: UpdateFormConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateFormConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update a form-backed integration connection.",
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
          schema: UpdateFormConnectionBadRequestResponseSchema,
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
          schema: UpdateFormConnectionNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "The integration connection cannot be edited in its current state.",
      content: {
        "application/json": {
          schema: UpdateFormConnectionConflictResponseSchema,
        },
      },
    },
  },
});
