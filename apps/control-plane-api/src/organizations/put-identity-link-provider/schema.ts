import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";

export const PutIdentityLinkProviderParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const PutIdentityLinkProviderBodySchema = z
  .object({
    integrationConnectionId: z.string().min(1),
  })
  .strict();

export const PutIdentityLinkProviderBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      IdentityLinkingBadRequestCodes.PROVIDER_CONFIG_AMBIGUOUS,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const PutIdentityLinkProviderNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND,
    IdentityLinkingNotFoundCodes.CONNECTION_NOT_FOUND,
  ]),
);
