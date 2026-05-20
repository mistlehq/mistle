import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderLinksResponseSchema } from "../schemas.js";
import {
  ListIdentityLinkProviderConfigLinksBadRequestResponseSchema,
  ListIdentityLinkProviderConfigLinksNotFoundResponseSchema,
  ListIdentityLinkProviderConfigLinksParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/identity-linking/provider-configs/:organizationProviderConfigId/links",
  tags: ["Organizations"],
  request: {
    params: ListIdentityLinkProviderConfigLinksParamsSchema,
  },
  responses: {
    200: {
      description: "Organization member identity-linking visibility for a provider config.",
      content: {
        "application/json": {
          schema: OrganizationIdentityLinkProviderLinksResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIdentityLinkProviderConfigLinksBadRequestResponseSchema,
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
          schema: ListIdentityLinkProviderConfigLinksNotFoundResponseSchema,
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
