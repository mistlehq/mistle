import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { profileImageUploadFormSchema } from "../../me/schemas.js";
import { OrganizationLogoParamsSchema } from "../organization-logo-schema.js";
import { organizationLogoResponseSchema } from "../schemas.js";

export const route = createRoute({
  method: "put",
  path: "/{organizationId}/logo",
  tags: ["Organizations"],
  request: {
    params: OrganizationLogoParamsSchema,
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
      description: "Upload or replace the active organization's logo.",
      content: {
        "application/json": {
          schema: organizationLogoResponseSchema,
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
    403: {
      description: "Forbidden request.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Organization was not found.",
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
