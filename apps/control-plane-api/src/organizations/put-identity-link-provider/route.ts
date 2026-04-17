import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderSchema } from "../schemas.js";
import {
  PutIdentityLinkProviderBadRequestResponseSchema,
  PutIdentityLinkProviderBodySchema,
  PutIdentityLinkProviderNotFoundResponseSchema,
  PutIdentityLinkProviderParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "put",
  path: "/identity-linking/providers/:providerFamily",
  tags: ["Organizations"],
  request: {
    params: PutIdentityLinkProviderParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PutIdentityLinkProviderBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Configure the integration connection used for identity linking.",
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
          schema: PutIdentityLinkProviderBadRequestResponseSchema,
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
          schema: PutIdentityLinkProviderNotFoundResponseSchema,
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
