import { createRoute, z } from "@hono/zod-openapi";
import {
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { profileImageMetadataResponseSchema, profileImageUploadFormSchema } from "../schemas.js";

export const route = createRoute({
  method: "put",
  path: "/profile-image",
  tags: ["Me"],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: profileImageUploadFormSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Upload or replace the authenticated user's profile image.",
      content: {
        "application/json": {
          schema: profileImageMetadataResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
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
    404: {
      description: "Authenticated user was not found.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
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
