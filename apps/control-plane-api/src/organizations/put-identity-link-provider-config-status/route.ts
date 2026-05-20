import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderConfigSchema } from "../schemas.js";
import {
  PutIdentityLinkProviderConfigStatusBadRequestResponseSchema,
  PutIdentityLinkProviderConfigStatusBodySchema,
  PutIdentityLinkProviderConfigStatusNotFoundResponseSchema,
  PutIdentityLinkProviderConfigStatusParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/identity-linking/provider-configs/:organizationProviderConfigId/status",
  tags: ["Organizations"],
  request: {
    params: PutIdentityLinkProviderConfigStatusParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PutIdentityLinkProviderConfigStatusBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update an identity-linking provider config status.",
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
          schema: PutIdentityLinkProviderConfigStatusBadRequestResponseSchema,
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
      description: "Identity-linking provider config was not found.",
      content: {
        "application/json": {
          schema: PutIdentityLinkProviderConfigStatusNotFoundResponseSchema,
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
