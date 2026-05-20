import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";

export const ListIdentityLinkProviderLinksParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const ListIdentityLinkProviderLinksBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(z.literal(IdentityLinkingBadRequestCodes.PROVIDER_CONFIG_AMBIGUOUS)),
  ValidationErrorResponseSchema,
]);

export const ListIdentityLinkProviderLinksNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND),
);
