import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { IntegrationConnectionSchema } from "../schemas.js";
import {
  CreateDraftFormConnectionBadRequestResponseSchema,
  CreateDraftFormConnectionBodySchema,
  CreateDraftFormConnectionNotFoundResponseSchema,
  CreateDraftFormConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/:methodId/draft",
  tags: ["Integrations"],
  request: {
    params: CreateDraftFormConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateDraftFormConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a draft form-backed integration connection.",
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
          schema: CreateDraftFormConnectionBadRequestResponseSchema,
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
          schema: CreateDraftFormConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
