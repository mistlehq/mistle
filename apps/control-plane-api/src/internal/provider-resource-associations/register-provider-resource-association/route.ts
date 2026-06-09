import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { z } from "zod";

import {
  InternalRegisterProviderResourceAssociationNotFoundResponseSchema,
  InternalRegisterProviderResourceAssociationRequestSchema,
  InternalRegisterProviderResourceAssociationResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/register",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: InternalRegisterProviderResourceAssociationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Register a provider resource association for internal callers.",
      content: {
        "application/json": {
          schema: InternalRegisterProviderResourceAssociationResponseSchema,
        },
      },
    },
    400: {
      description: "Request validation failed.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    404: {
      description: "Referenced resource was not found.",
      content: {
        "application/json": {
          schema: InternalRegisterProviderResourceAssociationNotFoundResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
        },
      },
    },
  },
});
