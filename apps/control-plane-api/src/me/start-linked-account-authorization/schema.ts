import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";

export const StartLinkedAccountAuthorizationParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const StartLinkedAccountAuthorizationBadRequestResponseSchema = createCodeMessageErrorSchema(
  z.union([
    z.literal(IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT),
    z.literal(IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_START_INPUT),
    z.literal(IdentityLinkingBadRequestCodes.PROVIDER_ADAPTER_NOT_IMPLEMENTED),
  ]),
);

export const StartLinkedAccountAuthorizationNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.union([
    z.literal(IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND),
    z.literal(IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND),
    z.literal(IdentityLinkingNotFoundCodes.CONNECTION_NOT_FOUND),
  ]),
);

export const StartLinkedAccountAuthorizationValidationErrorResponseSchema =
  ValidationErrorResponseSchema;
