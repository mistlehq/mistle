import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderConfigSchema } from "../schemas.js";
import {
  DeleteIdentityLinkProviderConfigBadRequestResponseSchema,
  DeleteIdentityLinkProviderConfigNotFoundResponseSchema,
  DeleteIdentityLinkProviderConfigParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/identity-linking/provider-configs/:organizationProviderConfigId",
  tags: ["Organizations"],
  request: {
    params: DeleteIdentityLinkProviderConfigParamsSchema,
  },
  responses: {
    200: {
      description: "Disable an identity-linking provider config.",
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
          schema: DeleteIdentityLinkProviderConfigBadRequestResponseSchema,
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
          schema: DeleteIdentityLinkProviderConfigNotFoundResponseSchema,
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
