import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";

export const PutGitHubLinkedAccountPreferredEmailBodySchema = z
  .object({
    preferredEmail: z.email(),
  })
  .strict();

export const PutGitHubLinkedAccountPreferredEmailBadRequestResponseSchema =
  createCodeMessageErrorSchema(
    z.literal(IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_PREFERRED_EMAIL_INPUT),
  );

export const PutGitHubLinkedAccountPreferredEmailNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal(IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_NOT_FOUND));

export { ValidationErrorResponseSchema };
