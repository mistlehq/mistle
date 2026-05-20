import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderConfigSchema } from "../schemas.js";
import {
  CreateIdentityLinkProviderConfigBadRequestResponseSchema,
  CreateIdentityLinkProviderConfigBodySchema,
  CreateIdentityLinkProviderConfigNotFoundResponseSchema,
  CreateIdentityLinkProviderConfigParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/identity-linking/providers/:providerFamily/configs",
  tags: ["Organizations"],
  request: {
    params: CreateIdentityLinkProviderConfigParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateIdentityLinkProviderConfigBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create an identity-linking provider config.",
      content: {
        "application/json": {
          schema: OrganizationIdentityLinkProviderConfigSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CreateIdentityLinkProviderConfigBadRequestResponseSchema,
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
      description: "Identity-linking provider or connection was not found.",
      content: {
        "application/json": {
          schema: CreateIdentityLinkProviderConfigNotFoundResponseSchema,
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
