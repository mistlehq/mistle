import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderSchema } from "../schemas.js";
import {
  PutIdentityLinkProviderStatusBadRequestResponseSchema,
  PutIdentityLinkProviderStatusBodySchema,
  PutIdentityLinkProviderStatusNotFoundResponseSchema,
  PutIdentityLinkProviderStatusParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/identity-linking/providers/:providerFamily/status",
  tags: ["Organizations"],
  request: {
    params: PutIdentityLinkProviderStatusParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PutIdentityLinkProviderStatusBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update the identity-linking provider status.",
      content: {
        "application/json": {
          schema: OrganizationIdentityLinkProviderSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: PutIdentityLinkProviderStatusBadRequestResponseSchema,
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
      description: "Identity-linking provider or configuration was not found.",
      content: {
        "application/json": {
          schema: PutIdentityLinkProviderStatusNotFoundResponseSchema,
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
