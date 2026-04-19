import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkProviderLinksResponseSchema } from "../schemas.js";
import { ListIdentityLinkProviderLinksParamsSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/identity-linking/providers/:providerFamily/links",
  tags: ["Organizations"],
  request: {
    params: ListIdentityLinkProviderLinksParamsSchema,
  },
  responses: {
    200: {
      description: "Organization member identity-linking visibility for a provider family.",
      content: {
        "application/json": {
          schema: OrganizationIdentityLinkProviderLinksResponseSchema,
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
