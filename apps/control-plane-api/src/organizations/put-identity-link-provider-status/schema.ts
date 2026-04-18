import { z } from "@hono/zod-openapi";
import { OrganizationIdentityLinkProviderConfigStatus } from "@mistle/db/control-plane";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";

export const PutIdentityLinkProviderStatusParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const PutIdentityLinkProviderStatusBodySchema = z
  .object({
    status: z.enum([
      OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      OrganizationIdentityLinkProviderConfigStatus.DISABLED,
    ]),
  })
  .strict();

export const PutIdentityLinkProviderStatusBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT]),
  ),
  ValidationErrorResponseSchema,
]);

export const PutIdentityLinkProviderStatusNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND,
    IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
  ]),
);
