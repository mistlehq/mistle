import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderSchema } from "../schemas.js";
import {
  DeleteIdentityLinkProviderNotFoundResponseSchema,
  DeleteIdentityLinkProviderParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/identity-linking/providers/:providerFamily",
  tags: ["Organizations"],
  request: {
    params: DeleteIdentityLinkProviderParamsSchema,
  },
  responses: {
    200: {
      description: "Disable the active organization's identity-linking provider configuration.",
      content: {
        "application/json": {
          schema: OrganizationIdentityLinkProviderSchema,
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
      description: "Identity-linking provider or provider config was not found.",
      content: {
        "application/json": {
          schema: DeleteIdentityLinkProviderNotFoundResponseSchema,
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
