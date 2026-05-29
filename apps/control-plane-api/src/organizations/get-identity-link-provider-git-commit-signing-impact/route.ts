import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { OrganizationIdentityLinkGitCommitSigningImpactSchema } from "../schemas.js";
import {
  GetIdentityLinkProviderGitCommitSigningImpactBadRequestResponseSchema,
  GetIdentityLinkProviderGitCommitSigningImpactNotFoundResponseSchema,
  GetIdentityLinkProviderGitCommitSigningImpactParamsSchema,
  GetIdentityLinkProviderGitCommitSigningImpactQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/identity-linking/providers/:providerFamily/git-commit-signing-impact",
  tags: ["Organizations"],
  request: {
    params: GetIdentityLinkProviderGitCommitSigningImpactParamsSchema,
    query: GetIdentityLinkProviderGitCommitSigningImpactQuerySchema,
  },
  responses: {
    200: {
      description: "Preview profile Git commit signing changes for an identity-linking change.",
      content: {
        "application/json": {
          schema: OrganizationIdentityLinkGitCommitSigningImpactSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: GetIdentityLinkProviderGitCommitSigningImpactBadRequestResponseSchema,
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
          schema: GetIdentityLinkProviderGitCommitSigningImpactNotFoundResponseSchema,
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
