import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { CreatedFormIntegrationConnectionSchema } from "../schemas.js";
import {
  CreateFormConnectionBadRequestResponseSchema,
  CreateFormConnectionBodySchema,
  CreateFormConnectionNotFoundResponseSchema,
  CreateFormConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/form",
  tags: ["Integrations"],
  request: {
    params: CreateFormConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateFormConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a form-backed integration connection.",
      content: {
        "application/json": {
          schema: CreatedFormIntegrationConnectionSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CreateFormConnectionBadRequestResponseSchema,
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
          schema: CreateFormConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
