import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderConfigSchema } from "../schemas.js";
import {
  PutIdentityLinkProviderConfigBadRequestResponseSchema,
  PutIdentityLinkProviderConfigBodySchema,
  PutIdentityLinkProviderConfigNotFoundResponseSchema,
  PutIdentityLinkProviderConfigParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/identity-linking/provider-configs/:organizationProviderConfigId",
  tags: ["Organizations"],
  request: {
    params: PutIdentityLinkProviderConfigParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PutIdentityLinkProviderConfigBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Update the integration connection used for an identity-linking provider config.",
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
          schema: PutIdentityLinkProviderConfigBadRequestResponseSchema,
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
      description: "Identity-linking provider config or connection was not found.",
      content: {
        "application/json": {
          schema: PutIdentityLinkProviderConfigNotFoundResponseSchema,
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
