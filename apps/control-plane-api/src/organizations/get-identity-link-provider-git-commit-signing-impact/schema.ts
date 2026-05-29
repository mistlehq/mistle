import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";
import { OrganizationIdentityLinkGitCommitSigningImpactActionSchema } from "../schemas.js";

export const GetIdentityLinkProviderGitCommitSigningImpactParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const GetIdentityLinkProviderGitCommitSigningImpactQuerySchema = z
  .object({
    integrationConnectionId: z.string().min(1),
    action: OrganizationIdentityLinkGitCommitSigningImpactActionSchema,
  })
  .strict();

export const GetIdentityLinkProviderGitCommitSigningImpactBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      IdentityLinkingBadRequestCodes.PROVIDER_CONFIG_AMBIGUOUS,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const GetIdentityLinkProviderGitCommitSigningImpactNotFoundResponseSchema =
  createCodeMessageErrorSchema(
    z.enum([
      IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND,
      IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
      IdentityLinkingNotFoundCodes.CONNECTION_NOT_FOUND,
    ]),
  );
