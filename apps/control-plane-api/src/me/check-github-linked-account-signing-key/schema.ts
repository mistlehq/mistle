import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";

export const CheckGitHubLinkedAccountSigningKeyResponseSchema = z
  .object({
    status: z.enum(["registered", "not_registered"]),
    publicKey: z.string().min(1),
    publicKeyFingerprint: z.string().min(1),
  })
  .strict();

export const CheckGitHubLinkedAccountSigningKeyBadRequestResponseSchema =
  createCodeMessageErrorSchema(
    z.literal(IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT),
  );

export const CheckGitHubLinkedAccountSigningKeyNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal(IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_NOT_FOUND));

export { ValidationErrorResponseSchema };
