import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";

export const PutGitHubLinkedAccountSigningKeyBadRequestResponseSchema =
  createCodeMessageErrorSchema(
    z.union([
      z.literal(IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT),
      z.literal(IdentityLinkingBadRequestCodes.PROVIDER_CONFIG_AMBIGUOUS),
    ]),
  );

export const PutGitHubLinkedAccountSigningKeyNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_NOT_FOUND),
);

export { ValidationErrorResponseSchema };
